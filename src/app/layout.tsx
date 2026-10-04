import type { Metadata } from "next";

import { getSiteTitle } from "@/lib/config/site-config";
import { siteUrl } from "@/lib/seo/site";
import "./globals.css";
import "@/styles/prose.css";

export async function generateMetadata(): Promise<Metadata> {
  const title = await getSiteTitle();
  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: `${title} · domonic18 的 AI 工程实战博客`,
      template: `%s | ${title}`,
    },
    description:
      "一起AI:第一人称、可复现的 AI 工程实战原创博客,Claude Code / MCP / LLM 训练与评测等主题。",
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // suppressHydrationWarning:下方预置脚本在水合前把 data-theme 改写为用户主题,
  // 服务端硬编码 "light" 必然属性不匹配;真实 DOM 值已是正确的,仅抑制该元素告警
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <body className="antialiased">
        {/* 主题预置(先于渲染执行防闪烁):显式选择(localStorage ah-theme)> 系统
            prefers-color-scheme > light;无显式选择时监听系统实时变化
            (DESIGN-SPEC §5,2026-10-04 定调;主题胶囊经 ah-theme-change 事件同步) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var apply=function(t){document.documentElement.dataset.theme=t};try{var saved=null;try{var v=localStorage.getItem("ah-theme");if(v==="dark"||v==="light")saved=v}catch(e){}if(saved){apply(saved);return}var mq=window.matchMedia("(prefers-color-scheme: dark)");var follow=function(){apply(mq.matches?"dark":"light");window.dispatchEvent(new CustomEvent("ah-theme-change"))};follow();mq.addEventListener("change",follow)}catch(e){apply("light")}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
