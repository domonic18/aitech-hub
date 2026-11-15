/**
 * Agent 宿主协议(M35 宿主唯一化):AssistantCard 全站唯一实例挂在根 layout
 * (AssistantFab 单点承载,跨路由持久,在跑 run 不随页面切换中断)。任何页面
 * 禁止自持卡实例(ESLint no-restricted-imports 守护,见 eslint.config.mjs)。
 * 页面接入只走一条协议通道:
 *  1. 唤起协议:openAgentAssistant() 派发 agent:open——开卡 + 可选预置问题
 *     直发/预填(ContactLauncher/TopicDraftActions/EditorAssistant 同款);
 *  2. run 收尾广播:AGENT_RUN_INACTIVE_EVENT(宿主→页面,唯一的反向通道;
 *     runtime-adapter 每 run 收尾派发,消费方以自身在途态为前提,无在途态
 *     零动作)。
 * 通道机制 = window CustomEvent(与 agent:open 同一机制,页面与宿主零组件树
 * 耦合);路由策略为纯函数(单测覆盖)。
 */

/** 宿主唤起事件(开卡;detail.ask 有值则注入预置问题) */
export const AGENT_OPEN_EVENT = "agent:open";

/**
 * Agent run 收尾广播(M44:runtime-adapter 在每次 run 起止派发,正常收尾/
 * 中断/异常全路径覆盖)。方向为宿主→页面(协议③,此前仅页面→宿主两条);
 * 消费方以自身在途态为前提——创作中心「生成中」监听后即时比对落库结果,
 * 无在途态时零动作(状态一律以 DB 为真相源)。
 * detail.interrupted(M46 验收补):本次 run 是否以 ask_user 中断挂起——
 * 挂起 = 等用户回答,在途态保持;非中断收尾 = 本轮定局,在途态无产出即清。
 */
export const AGENT_RUN_INACTIVE_EVENT = "agent:run-inactive";

/** run 收尾广播载荷(runtime-adapter 派发;缺 detail 的旧事件按非中断计) */
export interface AgentRunInactiveDetail {
  interrupted: boolean;
}

/** 安全读取收尾广播载荷(CustomEvent detail 形态不限;非对象/缺键按非中断计) */
export function readRunInactiveDetail(detail: unknown): AgentRunInactiveDetail {
  if (typeof detail === "object" && detail !== null && "interrupted" in detail) {
    return { interrupted: (detail as { interrupted?: unknown }).interrupted === true };
  }
  return { interrupted: false };
}

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
 * - 登录页 /admin/login:登录流程聚焦,不设助手入口。
 * 2026-11-15(B3):编辑页原本藏钮——顶栏 EditorAssistant 入口在场,防双入口;
 * 该入口下线后编辑页只剩 FAB 一处入口,藏钮等于「编辑页没有助手」,改为照常显钮。
 * prod 端 usePathname 带尾斜杠,统一归一化处理(与 buildAgentPageContext 同式)。
 */
export function agentFabButtonVisible(pathname: string): boolean {
  const route = pathname.replace(/\/+$/, "") || "/";
  if (/^\/admin\/login$/.test(route)) return false;
  return true;
}
