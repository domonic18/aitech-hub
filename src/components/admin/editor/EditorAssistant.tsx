"use client";

/**
 * 编辑页 AI 助手入口(M27 批①;M35 宿主唯一化改版):顶栏按钮经唤起协议
 * (openAgentAssistant)开全局宿主卡并注入编辑上下文——本组件不再自持卡
 * (M31 验收实证页面自持卡随路由卸载杀 run),getContent/onApplyContent 写回
 * 接线经能力注册协议(useAgentEditSurface)挂载注册/卸载自动注销;能力不在
 * 场时 propose_edits 评审自动降级(AgentThread 既有语义),run 本身跨页存活,
 * 切回编辑页且中断未 resume 时评审面自动恢复。admin 会话即 member 身份。
 * 评审面接线(M27 批⑧-d):getContent/onApplyContent 由 PostEditor 传入
 * (正文 state getter/setter),提案「应用」经此写回编辑器 → 既有自动保存链
 * 落库;编辑页恒传,注册句柄经 getter 透传最新引用。
 * 程序化唤起(M31):弹窗「生成候选」等入口经 launch prop 直发消息并自动开卡。
 */
import { useEffect } from "react";

import { openAgentAssistant, useAgentEditSurface } from "@/lib/agent/agent-host";

/** 外部唤醒载荷(封面生成等入口):question 直发,nonce 防同文重触发不生效 */
export interface AssistantLaunch {
  question: string;
  nonce: number;
}

interface EditorAssistantProps {
  postId: string;
  title: string;
  /** 评审面接线(M27 批⑧-d):正文读快照 / 写回 */
  getContent: () => string;
  onApplyContent: (md: string) => void;
  /** 程序化唤起(M31):弹窗「生成候选」等入口直发消息并自动开卡 */
  launch?: AssistantLaunch | null;
}

export default function EditorAssistant({
  postId,
  title,
  getContent,
  onApplyContent,
  launch,
}: EditorAssistantProps): React.ReactElement {
  // 能力注册协议(②):挂载注册/卸载注销,宿主卡经此获得写回接线
  useAgentEditSurface({ postId, title, getContent, onApplyContent });

  // 程序化唤起:开卡 + 注入直发消息(宿主 injectAsk → pending → append)
  useEffect(() => {
    if (!launch) return;
    openAgentAssistant({ question: launch.question, send: true });
  }, [launch]);

  return (
    <button
      type="button"
      aria-label="AI 助手"
      title="AI 助手(对话改稿,当前编辑上下文自动注入)"
      onClick={() => openAgentAssistant()}
      className="inline-flex cursor-pointer items-center rounded-sm border border-line bg-panel px-2 py-2 text-text-2 hover:border-line-hover hover:text-text-1"
    >
      <svg className="ic" aria-hidden="true">
        <use href="#i-robot" />
      </svg>
    </button>
  );
}
