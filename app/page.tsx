"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import {
  ArrowUp,
  Compass,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "wendao.chat.v1";
const TTS_PREF_KEY = "wendao.tts.on";
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const API_URL = `${BASE}/api/chat`;
const TTS_URL = `${BASE}/api/tts`;

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 载入本地历史 + 语音偏好
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
      const pref = localStorage.getItem(TTS_PREF_KEY);
      if (pref === "0") setTtsOn(false);
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
    setSpeaking(null);
  }, []);

  const speak = useCallback(
    async (text: string, index: number) => {
      stopAudio();
      const clean = text.trim();
      if (!clean) return;
      try {
        const res = await fetch(TTS_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: clean }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        setSpeaking(index);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setSpeaking((cur) => (cur === index ? null : cur));
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          setSpeaking((cur) => (cur === index ? null : cur));
        };
        await audio.play().catch(() => setSpeaking(null));
      } catch {
        setSpeaking(null);
      }
    },
    [stopAudio]
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
          body: JSON.stringify({ messages: next }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => "");
          throw new Error(errText || `请求失败（${res.status}）`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const assistantIndex = next.length;
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
        }
        if (ttsOn && acc.trim()) speak(acc, assistantIndex);
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
    [messages, streaming, ttsOn, speak]
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const empty = messages.length === 0;

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
          {!empty && (
            <button className="icon-btn" onClick={reset} title="新的对话">
              <RotateCcw size={18} strokeWidth={1.7} />
            </button>
          )}
        </div>
      </header>

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
        <div className="composer-inner">
          <textarea
            ref={taRef}
            value={input}
            placeholder="说说你正在纠结、想不通的那件事……"
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
          问道会把回答读给你听 · 短而准，一句话点醒 · Enter 发送
        </p>
      </div>
    </div>
  );
}
