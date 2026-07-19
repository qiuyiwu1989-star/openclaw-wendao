import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "问道 · 深度思考教练",
  description:
    "不给答案，带你把问题想清楚。一个教练式的深度思考对话智能体。深脑（DeepBrain）出品。",
  applicationName: "问道",
  appleWebApp: { capable: true, title: "问道", statusBarStyle: "black-translucent" },
  openGraph: {
    title: "问道 · 深度思考教练",
    description: "不给答案，带你把问题想清楚。",
    siteName: "问道",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0f1115",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
