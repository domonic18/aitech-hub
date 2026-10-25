"use client";
/**
 * AgentDrawer 懒载壳(M48 批F):Drawer 静态链(AgentThread → @assistant-ui
 * 运行时 ≈170K gz)原随 /search 首屏包(288K);壳 ssr:false——Drawer 初始
 * 无 SSR 面(挂载后由 search:agent-ask 事件唤起),行为不变,chunk 异步补拉。
 * 页面是 Server Component 不能直接用 ssr:false 的 dynamic,故有本壳。
 */
import dynamic from "next/dynamic";

const AgentDrawer = dynamic(() => import("./AgentDrawer"), { ssr: false });

export default function AgentDrawerLazy(): React.ReactElement {
  return <AgentDrawer />;
}
