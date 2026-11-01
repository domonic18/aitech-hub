import type { Metadata } from "next";

import AssistantFab from "@/components/site/assistant/AssistantFab";
import { getSiteTitle } from "@/lib/config/site-config";
import { siteUrl } from "@/lib/seo/site";
import { SITE_DESCRIPTION, SITE_TAGLINE } from "@/lib/site-meta";
import "./globals.css";
import "@/styles/prose.css";

export async function generateMetadata(): Promise<Metadata> {
  const title = await getSiteTitle();
  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: `${title} · ${SITE_TAGLINE}`,
      // 站点名在前、子页标题在后(2026-10-31 验收定调;此前 `%s | 站名` 是反的)
      template: `${title} | %s`,
    },
    description: SITE_DESCRIPTION,
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
            (DESIGN-SPEC §5,2026-10-04 定调;主题胶囊经 ah-theme-change 事件同步)。
            自愈哨兵(M16 反馈:整根重渲染/版本偏斜会把 data-theme 打回服务端默认
            "light"):MutationObserver 守住 data-theme,被改写即按同款优先级复原。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var apply=function(t){document.documentElement.dataset.theme=t};var want=function(){try{var v=localStorage.getItem("ah-theme");if(v==="dark"||v==="light")return v}catch(e){}try{return window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){return"light"}};try{apply(want());if(!window.__ahThemeWatch){window.__ahThemeWatch=1;new MutationObserver(function(){var x=want();if(document.documentElement.dataset.theme!==x){apply(x);window.dispatchEvent(new CustomEvent("ah-theme-change"))}}).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]})}var mq=window.matchMedia("(prefers-color-scheme: dark)");mq.addEventListener("change",function(){try{if(localStorage.getItem("ah-theme"))return}catch(e){}apply(mq.matches?"dark":"light");window.dispatchEvent(new CustomEvent("ah-theme-change"))})}catch(e){apply("light")}})();`,
          }}
        />
        {children}
        {/* Agent 宿主唯一化(M35):全站唯一 AssistantCard 宿主挂根 layout,
            跨路由持久——在跑 run 不随任何页面切换(admin↔site 同理)中断;
            页面接入只走 src/lib/agent/agent-host.ts 两协议,禁止自持卡 */}
        <AssistantFab />
      </body>
    </html>
  );
}
