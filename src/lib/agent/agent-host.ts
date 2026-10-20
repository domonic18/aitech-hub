/**
 * Agent 宿主协议(M35 宿主唯一化):AssistantCard 全站唯一实例挂在根 layout
 * (AssistantFab 单点承载,跨路由持久,在跑 run 不随页面切换中断)。任何页面
 * 禁止自持卡实例(ESLint no-restricted-imports 守护,见 eslint.config.mjs)。
 * 页面接入只走两条协议通道:
 *  1. 唤起协议:openAgentAssistant() 派发 agent:open——开卡 + 可选预置问题
 *     直发/预填(ContactLauncher/TopicDraftActions/EditorAssistant 同款);
 *  2. 能力注册协议:useAgentEditSurface(EditorAssistant)——挂载注册编辑面
 *     getContent/onApplyContent 写回接线,卸载自动注销;能力不在场时
 *     propose_edits 评审自动降级(AgentThread 既有语义),run 本身不中断,
 *     切回编辑页能力重新注册即可继续评审(降级已 resume 的中断除外)。
 * 通道机制 = window CustomEvent(与 agent:open 同一机制,页面与宿主零组件树
 * 耦合);路由策略为纯函数(单测覆盖)。
 */
import { useEffect, useMemo, useRef } from "react";

import type { EditSurfaceContext } from "@/components/site/agent/AgentThread";

/** 宿主唤起事件(开卡;detail.ask 有值则注入预置问题) */
export const AGENT_OPEN_EVENT = "agent:open";

/** 宿主能力注册事件(detail = 编辑面接线对象;null = 注销) */
export const AGENT_SURFACE_EVENT = "agent:surface";

/** 能力重报请求(宿主挂载监听后广播,补偿注册先于监听的时序竞态) */
export const AGENT_SURFACE_ANNOUNCE_EVENT = "agent:surface-announce";

/** 唤起载荷(ask.send: true=直发,false=仅预填输入框) */
export interface AgentOpenAsk {
  question: string;
  send: boolean;
}

/**
 * 程序化唤起宿主卡:开卡 + 可选注入预置问题。全站唯一合法入口——页面不得
 * 自行实例化 AssistantCard(宿主唯一化红线)。
 */
export function openAgentAssistant(ask?: AgentOpenAsk): void {
  window.dispatchEvent(new CustomEvent(AGENT_OPEN_EVENT, { detail: ask ? { ask } : {} }));
}

/**
 * FAB 按钮显隐路由策略(卡本身永驻——按钮藏 ≠ 卡卸载,在跑 run 不中断):
 * - 编辑页 /admin/posts/<id>:顶栏 EditorAssistant 入口在场,FAB 藏钮防双入口
 *   (M27 UX 决策保留,退役令从「整卡 return null」改为「仅藏按钮」);
 * - 登录页 /admin/login:登录流程聚焦,不设助手入口。
 * prod 端 usePathname 带尾斜杠,统一归一化处理(与 buildAgentPageContext 同式)。
 */
export function agentFabButtonVisible(pathname: string): boolean {
  const route = pathname.replace(/\/+$/, "") || "/";
  if (/^\/admin\/posts\/\d+$/.test(route)) return false;
  if (/^\/admin\/login$/.test(route)) return false;
  return true;
}

/**
 * 编辑面能力注册 hook(协议②,EditorAssistant 专用):挂载注册、卸载注销。
 * 函数/标题 props 每渲染可能换引用(编辑器 state 闭包),注册句柄经 getter
 * 透传最新值(宿主 state 仅在注册/注销时变更,编辑器逐键重渲染零事件开销);
 * 句柄对象身份稳定,AgentThread 既有函数在场判定(typeof === "function")与
 * 降级语义原样生效。
 */
export function useAgentEditSurface(surface: EditSurfaceContext): void {
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const handle = useMemo<EditSurfaceContext>(
    () => ({
      get postId() {
        return surfaceRef.current.postId;
      },
      get title() {
        return surfaceRef.current.title;
      },
      get getContent() {
        return surfaceRef.current.getContent;
      },
      get onApplyContent() {
        return surfaceRef.current.onApplyContent;
      },
    }),
    [],
  );
  useEffect(() => {
    const announce = (): void => {
      window.dispatchEvent(new CustomEvent(AGENT_SURFACE_EVENT, { detail: handle }));
    };
    announce();
    // 迟到订阅者补偿:根 layout 中宿主 AssistantFab 排在 children 之后,React
    // effect 自底向上,页面(编辑面)注册派发可先于宿主挂监听——宿主就绪后
    // 广播重报请求,已挂载编辑面补派(触发于 AssistantFab 监听挂载后)
    window.addEventListener(AGENT_SURFACE_ANNOUNCE_EVENT, announce);
    return () => {
      window.removeEventListener(AGENT_SURFACE_ANNOUNCE_EVENT, announce);
      window.dispatchEvent(new CustomEvent(AGENT_SURFACE_EVENT, { detail: null }));
    };
  }, [handle]);
}
