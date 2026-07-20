"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import {
  createSpeechQueue,
  speechSupported,
  takeSentences,
  type SpeechQueue,
} from "@/lib/speechQueue";
import {
  startVoiceCapture,
  recorderSupported,
  type VoiceCapture,
} from "@/lib/recorder";
import {
  ArrowUp,
  BookOpen,
  Compass,
  Mic,
  Phone,
  PhoneOff,
  RotateCcw,
  Settings2,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "wendao.chat.v1";
const TTS_PREF_KEY = "wendao.tts.on";
const VOICE_PREF_KEY = "wendao.voice";
const VOICES = [
  { id: "苏打", label: "苏打", gender: "男声" },
  { id: "白桦", label: "白桦", gender: "男声" },
  { id: "冰糖", label: "冰糖", gender: "女声" },
  { id: "茉莉", label: "茉莉", gender: "女声" },
];
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const API_URL = `${BASE}/api/chat`;
const TTS_URL = `${BASE}/api/tts`;
const ASR_URL = `${BASE}/api/asr`;

const STARTERS = [
  "我该不该辞职去创业？",
  "团队推不动项目，我很焦虑",
  "帮我彻底想清楚一件事",
  "这个判断背后我漏了什么？",
];

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text: string): string {
  try {
    return marked.parse(text) as string;
  } catch {
    return text;
  }
}

export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [ttsOn, setTtsOn] = useState(true);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [callMode, setCallMode] = useState(false);
  const [voice, setVoice] = useState("苏打");
  const [showVoices, setShowVoices] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speechRef = useRef<SpeechQueue | null>(null);
  const captureRef = useRef<VoiceCapture | null>(null);
  const callActiveRef = useRef(false);
  const relistenRef = useRef<(() => void) | null>(null);

  // 载入本地历史 + 语音偏好
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
      const pref = localStorage.getItem(TTS_PREF_KEY);
      if (pref === "0") setTtsOn(false);
      const vp = localStorage.getItem(VOICE_PREF_KEY);
      if (vp && VOICES.some((v) => v.id === vp)) setVoice(vp);
    } catch {
      /* ignore */
    }
  }, []);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
    }
    audioRef.current = null;
    if (speechRef.current) {
      speechRef.current.stop();
      speechRef.current = null;
    }
    setSpeaking(null);
  }, []);

  // 降级：一次性拿完整 wav 再播（Web Audio 不可用时）
  const speakWav = useCallback(async (text: string, index: number) => {
    const res = await fetch(TTS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, stream: false }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    setSpeaking(index);
    const clear = () => {
      URL.revokeObjectURL(url);
      setSpeaking((cur) => (cur === index ? null : cur));
    };
    audio.onended = clear;
    audio.onerror = clear;
    await audio.play().catch(() => setSpeaking(null));
  }, []);

  // 新建一个句级语音队列（自动播放 + 手动重听共用）
  const newQueue = useCallback((index: number): SpeechQueue => {
    const q = createSpeechQueue({
      url: TTS_URL,
      voice,
      onStart: () => setSpeaking(index),
      onDrain: () => {
        setSpeaking((cur) => (cur === index ? null : cur));
        // 通话模式：问道说完，自动接着听用户
        if (callActiveRef.current) relistenRef.current?.();
      },
    });
    speechRef.current = q;
    return q;
  }, [voice]);

  const pickVoice = useCallback((id: string) => {
    setVoice(id);
    setShowVoices(false);
    try {
      localStorage.setItem(VOICE_PREF_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  // 手动重听整段：整段作为一句推进队列
  const speak = useCallback(
    async (text: string, index: number) => {
      stopAudio();
      const clean = text.trim();
      if (!clean) return;
      if (speechSupported()) {
        const q = newQueue(index);
        q.push(clean);
        q.end();
        return;
      }
      try {
        await speakWav(clean, index);
      } catch {
        setSpeaking(null);
      }
    },
    [stopAudio, speakWav, newQueue]
  );

  const toggleTts = useCallback(() => {
    setTtsOn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TTS_PREF_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (!next) stopAudio();
      return next;
    });
  }, [stopAudio]);

  // 持久化
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const autoGrow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;

      const next: Msg[] = [...messages, { role: "user", content }];
      setMessages([...next, { role: "assistant", content: "" }]);
      setInput("");
      setStreaming(true);
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.style.height = "auto";
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // fast=ttsOn：要听语音就走无思考抢延迟；纯打字保留思考
          body: JSON.stringify({ messages: next, fast: ttsOn }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => "");
          throw new Error(errText || `请求失败（${res.status}）`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const assistantIndex = next.length;

        // 句级流式朗读：整句一出就推进队列，不等整段
        const pipeline = ttsOn && speechSupported();
        const queue = pipeline ? newQueue(assistantIndex) : null;
        let spokenLen = 0;
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const copy = prev.slice();
            copy[copy.length - 1] = { role: "assistant", content: acc };
            return copy;
          });
          if (queue) {
            const { segments, next: n } = takeSentences(acc, spokenLen);
            for (const s of segments) queue.push(s);
            spokenLen = n;
          }
        }
        if (queue) {
          const tail = acc.slice(spokenLen).trim();
          if (tail) queue.push(tail);
          queue.end();
        } else if (ttsOn && acc.trim()) {
          // Web Audio 不可用：整段 wav 降级
          speak(acc, assistantIndex);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // 用户主动停止：保留已生成内容
        } else {
          const msg = err instanceof Error ? err.message : "网络错误";
          setMessages((prev) => {
            const copy = prev.slice();
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = {
              role: "assistant",
              content: (last?.content || "") + `\n\n[连接问道失败：${msg}]`,
            };
            return copy;
          });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming, ttsOn, speak, newQueue]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    stopAudio();
  }, [stopAudio]);

  const reset = useCallback(() => {
    if (streaming) stop();
    stopAudio();
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [streaming, stop, stopAudio]);

  // 语音输入：MediaRecorder + VAD 录音 → MiMo ASR 转写（不用浏览器 Web Speech，
  // 后者走谷歌服务器国内被墙）。说完静音自动收尾。
  useEffect(() => {
    setMicSupported(recorderSupported());
  }, []);

  const transcribe = useCallback(async (wav: Blob): Promise<string> => {
    try {
      const res = await fetch(ASR_URL, {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: wav,
      });
      if (!res.ok) return "";
      const j = (await res.json()) as { text?: string };
      return (j.text || "").trim();
    } catch {
      return "";
    }
  }, []);

  const stopCapture = useCallback(() => {
    captureRef.current?.stop();
  }, []);

  const listen = useCallback(async () => {
    if (streaming) return;
    stopAudio();
    setListening(true);
    const relisten = () => {
      if (callActiveRef.current)
        setTimeout(() => callActiveRef.current && relistenRef.current?.(), 350);
    };
    try {
      captureRef.current = await startVoiceCapture({
        onResult: async (wav) => {
          captureRef.current = null;
          setListening(false);
          setTranscribing(true);
          const text = await transcribe(wav);
          setTranscribing(false);
          if (text) {
            setInput(text);
            send(text);
          } else relisten();
        },
        onNoSpeech: () => {
          captureRef.current = null;
          setListening(false);
          relisten();
        },
        onError: (e) => {
          captureRef.current = null;
          setListening(false);
          const name = (e as { name?: string } | undefined)?.name || "";
          if (/NotAllowed|Security|Permission/i.test(name)) {
            // 权限被拒：别无限重试，退出通话并提示
            callActiveRef.current = false;
            setCallMode(false);
            setMicDenied(true);
          } else {
            relisten(); // 瞬时错误：通话中重试
          }
        },
      });
    } catch {
      setListening(false);
    }
  }, [streaming, stopAudio, transcribe, send]);

  relistenRef.current = listen;

  // 进通话前预热 MiMo prompt cache：偷偷发一个 fast 请求跑完系统提示词 prefill，
  // 让第一轮不吃冷启动的几秒。拿到首字节就断（缓存已暖），不影响 UI。
  const prewarm = useCallback(() => {
    const ac = new AbortController();
    fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "在吗" }], fast: true }),
      signal: ac.signal,
    })
      .then(async (res) => {
        const reader = res.body?.getReader();
        await reader?.read(); // 收到第一块即说明 prefill 完成、缓存已暖
        ac.abort();
      })
      .catch(() => {});
  }, []);

  const toggleMic = useCallback(() => {
    if (listening) stopCapture();
    else listen();
  }, [listening, listen, stopCapture]);

  const startCall = useCallback(() => {
    setMicDenied(false);
    callActiveRef.current = true;
    setCallMode(true);
    if (!ttsOn) toggleTts(); // 通话必须能出声
    stopAudio();
    prewarm(); // 用户授权麦克风/开口这几秒里把缓存焐热
    listen();
  }, [ttsOn, toggleTts, stopAudio, listen, prewarm]);

  const endCall = useCallback(() => {
    callActiveRef.current = false;
    setCallMode(false);
    captureRef.current?.cancel();
    captureRef.current = null;
    setListening(false);
    setTranscribing(false);
    stopAudio();
    if (streaming) abortRef.current?.abort();
    setInput("");
  }, [stopAudio, streaming]);

  // 通话中点一下：打断当前（跳过问道正在说/在想的），立刻回到听
  const interruptCall = useCallback(() => {
    if (streaming) abortRef.current?.abort();
    captureRef.current?.cancel();
    captureRef.current = null;
    stopAudio();
    setTimeout(() => callActiveRef.current && listen(), 150);
  }, [streaming, stopAudio, listen]);

  const callPhase = speaking !== null
    ? "speaking"
    : streaming || transcribing
    ? "thinking"
    : listening
    ? "listening"
    : "idle";

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const empty = messages.length === 0;

  // 通话屏上显示最近一轮，避免"盲对话"（也能看出 ASR 有没有听错）
  const lastUserSaid = callMode
    ? [...messages].reverse().find((m) => m.role === "user")?.content || ""
    : "";
  const lastReply =
    callMode &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "assistant"
      ? messages[messages.length - 1].content
      : "";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Compass size={20} strokeWidth={1.6} />
          </div>
          <div>
            <div className="brand-name">问道</div>
            <div className="brand-sub">深度思考教练 · 深脑出品</div>
          </div>
        </div>
        <div className="topbar-actions">
          {micSupported && (
            <button
              className="icon-btn"
              onClick={startCall}
              title="通话模式（免手对话）"
            >
              <Phone size={18} strokeWidth={1.7} />
            </button>
          )}
          <a className="icon-btn" href={`${BASE}/about`} title="关于问道 · 方法">
            <BookOpen size={18} strokeWidth={1.7} />
          </a>
          <button
            className={"icon-btn" + (ttsOn ? " icon-btn-on" : "")}
            onClick={toggleTts}
            title={ttsOn ? "语音已开（点击静音）" : "语音已关（点击开启）"}
          >
            {ttsOn ? (
              <Volume2 size={18} strokeWidth={1.7} />
            ) : (
              <VolumeX size={18} strokeWidth={1.7} />
            )}
          </button>
          <div className="voice-wrap">
            <button
              className={"icon-btn" + (showVoices ? " icon-btn-on" : "")}
              onClick={() => setShowVoices((s) => !s)}
              title="音色"
            >
              <Settings2 size={18} strokeWidth={1.7} />
            </button>
            {showVoices && (
              <>
                <div
                  className="voice-backdrop"
                  onClick={() => setShowVoices(false)}
                />
                <div className="voice-pop">
                  <div className="voice-pop-title">问道的声音</div>
                  {VOICES.map((v) => (
                    <button
                      key={v.id}
                      className={"voice-item" + (voice === v.id ? " on" : "")}
                      onClick={() => pickVoice(v.id)}
                    >
                      <span>{v.label}</span>
                      <span className="voice-g">{v.gender}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {!empty && (
            <button className="icon-btn" onClick={reset} title="新的对话">
              <RotateCcw size={18} strokeWidth={1.7} />
            </button>
          )}
        </div>
      </header>

      {callMode && (
        <div className="call" role="dialog" aria-modal="true">
          <div className="call-inner">
            <div className="call-title">通话模式</div>
            <button
              className={`call-orb call-${callPhase}`}
              onClick={interruptCall}
              title="点一下可打断"
            >
              <Compass size={44} strokeWidth={1.2} />
            </button>
            <div className="call-state">
              {callPhase === "listening"
                ? "在听你说……"
                : callPhase === "thinking"
                ? "问道在想……"
                : callPhase === "speaking"
                ? "问道在说……"
                : "……"}
            </div>
            <div className="call-hint">
              {callPhase === "speaking" || callPhase === "thinking"
                ? "点圆圈可打断，直接说"
                : "说完停一下，问道自然会接话"}
            </div>
            {(lastUserSaid || lastReply) && (
              <div className="call-transcript">
                {lastUserSaid && (
                  <div className="call-you">你：{lastUserSaid}</div>
                )}
                {lastReply && <div className="call-reply">{lastReply}</div>}
              </div>
            )}
            <button className="call-end" onClick={endCall}>
              <PhoneOff size={18} strokeWidth={1.9} />
              结束通话
            </button>
          </div>
        </div>
      )}

      {empty ? (
        <div className="hero">
          <h1 className="hero-title">问道</h1>
          <p className="hero-tag">不给答案，带你把问题想清楚。</p>
          <div className="starters">
            {STARTERS.map((s) => (
              <button key={s} className="starter" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="scroll" ref={scrollRef}>
          {messages.map((m, i) => {
            if (m.role === "user") {
              return (
                <div className="msg msg-user" key={i}>
                  <div className="bubble-user">{m.content}</div>
                </div>
              );
            }
            const isLast = i === messages.length - 1;
            const showCursor = streaming && isLast;
            const isSpeaking = speaking === i;
            return (
              <div className="msg msg-assistant" key={i}>
                <div className={"avatar" + (isSpeaking ? " avatar-speaking" : "")}>
                  <Compass size={17} strokeWidth={1.7} />
                </div>
                <div className="assistant-body">
                  {m.content ? (
                    <div
                      className="prose"
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(m.content),
                      }}
                    />
                  ) : null}
                  {showCursor && <span className="cursor" />}
                  {m.content && !showCursor && (
                    <button
                      className={"speak-btn" + (isSpeaking ? " speak-btn-on" : "")}
                      onClick={() =>
                        isSpeaking ? stopAudio() : speak(m.content, i)
                      }
                      title={isSpeaking ? "停止朗读" : "朗读这段"}
                    >
                      {isSpeaking ? (
                        <VolumeX size={14} strokeWidth={1.8} />
                      ) : (
                        <Volume2 size={14} strokeWidth={1.8} />
                      )}
                      <span>{isSpeaking ? "朗读中" : "朗读"}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="composer">
        <div className={"composer-inner" + (listening ? " composer-listening" : "")}>
          {micSupported && (
            <button
              className={"mic-btn" + (listening ? " mic-btn-on" : "")}
              onClick={toggleMic}
              disabled={streaming || transcribing}
              title={listening ? "在听……点击结束" : "语音输入"}
            >
              <Mic size={18} strokeWidth={1.8} />
            </button>
          )}
          <textarea
            ref={taRef}
            value={input}
            placeholder={
              transcribing
                ? "识别中……"
                : listening
                ? "在听……说完自动发送"
                : "说说你正在纠结、想不通的那件事……"
            }
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow();
            }}
            onKeyDown={onKeyDown}
          />
          {streaming ? (
            <button className="send-btn" onClick={stop} title="停止">
              <Square size={16} strokeWidth={2} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={() => send(input)}
              disabled={!input.trim()}
              title="发送"
            >
              <ArrowUp size={20} strokeWidth={2.2} />
            </button>
          )}
        </div>
        <p className="composer-hint">
          {micDenied
            ? "麦克风没授权——点地址栏左侧的锁/图标，允许麦克风后再试"
            : micSupported
            ? "点麦克风说，或打字都行 · 问道会把回答读给你听"
            : "问道会把回答读给你听 · 短而准，一句话点醒 · Enter 发送"}
        </p>
      </div>
    </div>
  );
}
