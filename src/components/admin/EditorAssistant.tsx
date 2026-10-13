"use client";

/**
 * 编辑页 AI 助手入口(M27 批①,方案 §3/§9):顶栏按钮唤起 AssistantCard
 * (复用全站 agent 域件,admin 会话即 member 身份),并注入编辑上下文
 * {postId, title}——卡片内以 chip 呈现,批② propose_edits/read_draft 的
 * 工具面挂点。embedded 形态:不渲染「隐藏助手」(无全站 FAB 语义),关闭即收。
 */
import { useState } from "react";

import AssistantCard from "@/components/site/assistant/AssistantCard";

export default function EditorAssistant({
  postId,
  title,
}: {
  postId: string;
  title: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="AI 助手"
        title="AI 助手(对话改稿,当前编辑上下文自动注入)"
        onClick={() => setOpen((v) => !v)}
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
      {open && (
        <AssistantCard
          embedded
          onClose={() => setOpen(false)}
          onHide={() => setOpen(false)}
          editContext={{ postId, title }}
        />
      )}
    </>
  );
}
