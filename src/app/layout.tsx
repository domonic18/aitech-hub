import type { Metadata } from "next";

import { siteUrl } from "@/lib/seo/site";
import "./globals.css";
import "@/styles/prose.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "一起AI技术 · domonic18 的 AI 工程实战博客",
    template: "%s | 一起AI技术",
  },
  description:
    "一起AI技术:第一人称、可复现的 AI 工程实战原创博客,Claude Code / MCP / LLM 训练与评测等主题。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-theme="light">
      <body className="antialiased">
        {/* 主题预置(先于渲染执行防闪烁;DESIGN-SPEC §5 双主题,禁跟随系统) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.dataset.theme=localStorage.getItem("ah-theme")||"light";`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
