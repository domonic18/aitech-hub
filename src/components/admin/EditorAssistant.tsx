"use client";

/**
 * 编辑页 AI 助手入口(M27 批①,方案 §3/§9):顶栏按钮唤起 AssistantCard
 * (复用全站 agent 域件,admin 会话即 member 身份),并注入编辑上下文
 * {postId, title}——卡片内以 chip 呈现。M27 批⑧-d 扩评审面接线:getContent/
 * onApplyContent 由 PostEditor 传入(正文 state getter/setter),propose_edits
 * 提案的「应用」经此写回编辑器 → 既有自动保存链落库;缺省(理论上不会发生,
 * 编辑页恒传)则提案自动降级。embedded 形态:不渲染「隐藏助手」(无全站 FAB
 * 语义)。常驻化(2026-10-14):首开才挂(零前置开销),此后关闭仅 display:none
 * ——在跑 agent run 不随卡卸载中断,再开即回(ai-invest 同款;卸载只随页面离开)。
 */
import { useState } from "react";

import AssistantCard from "@/components/site/assistant/AssistantCard";

interface EditorAssistantProps {
  postId: string;
  title: string;
  /** 评审面接线(M27 批⑧-d):正文读快照 / 写回 */
  getContent: () => string;
  onApplyContent: (md: string) => void;
}

export default function EditorAssistant({
  postId,
  title,
  getContent,
  onApplyContent,
}: EditorAssistantProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  /** 首开后恒挂载:关闭仅隐藏(见 docstring 常驻化) */
  const [everOpened, setEverOpened] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="AI 助手"
        title="AI 助手(对话改稿,当前编辑上下文自动注入)"
        onClick={() => {
          setEverOpened(true);
          setOpen((v) => !v);
        }}
        className={`inline-flex cursor-pointer items-center rounded-sm border px-2 py-2 ${
          open
            ? "border-accent text-accent"
            : "border-line bg-panel text-text-2 hover:border-line-hover hover:text-text-1"
        }`}
      >
        <svg className="ic" aria-hidden="true">
          <use href="#i-robot" />
        </svg>
      </button>
      {everOpened && (
        <div className={open ? "contents" : "hidden"}>
          <AssistantCard
            embedded
            onClose={() => setOpen(false)}
            onHide={() => setOpen(false)}
            editContext={{ postId, title, getContent, onApplyContent }}
          />
        </div>
      )}
    </>
  );
}
