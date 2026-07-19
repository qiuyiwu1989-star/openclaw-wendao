import { Compass } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default function NotFound() {
  return (
    <div className="notfound">
      <div className="notfound-mark">
        <Compass size={26} strokeWidth={1.5} />
      </div>
      <h1 className="notfound-title">这条路暂时没有</h1>
      <p className="notfound-tag">但问题还可以接着想。</p>
      <a className="notfound-btn" href={`${BASE}/`}>
        回到对话
      </a>
    </div>
  );
}
