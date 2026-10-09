"use client";
/**
 * HITL 提问卡(2026-10-09 验收反馈):agent ask_user 中断的结构化回答面——
 * 问题文本 + 候选选项点选 + 自由文本输入,替换输入区(中断期间禁言,防新
 * 消息打到悬空 tool_call 上)。提交经 useLangGraphSendCommand 回灌
 * Command({resume})(LangGraphCommand 类型钉死 string,对象经自有 adapter
 * 原样 JSON 序列化,cast 仅为过类型)。中断清位:resume run 的首个普通
 * updates 帧会把中断状态置空(assistant-ui 逐帧 setInterrupt),卡片随之
 * 消失、输入区回归,无需手动复位。载荷解析收口 src/lib/agent/hitl.ts。
 */
import {
  useLangGraphInterruptState,
  useLangGraphSendCommand,
  type LangGraphCommand,
} from "@assistant-ui/react-langgraph";
import { useState } from "react";

import {
  buildAskUserResumeCommand,
  parseAgentAskUserInterrupt,
  type AgentAskUserResume,
} from "@/lib/agent/hitl";

export default function AgentInterruptCard(): React.ReactElement | null {
  const interrupt = useLangGraphInterruptState();
  const sendCommand = useLangGraphSendCommand();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (interrupt === undefined) return null;
  const payload = parseAgentAskUserInterrupt(interrupt.value);
  const question = payload?.question ?? "助手需要你的补充输入";
  const options = payload?.options;

  const submit = async (resume: AgentAskUserResume): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await sendCommand(buildAskUserResumeCommand(resume) as unknown as LangGraphCommand);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t border-line p-3" aria-label="助手提问">
      <div className="mb-2 flex items-center gap-1.5 font-mono text-[10.5px] text-accent">
        <svg className="ic" aria-hidden="true">
          <use href="#i-robot" />
        </svg>
        助手提问 · 等待你的回答
      </div>
      <p className="mb-2.5 text-[13.5px] leading-[1.7] text-text-1">{question}</p>
      {options && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={submitting}
              onClick={() => void submit({ message: opt, option: opt })}
              className="cursor-pointer rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-text-2 transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2 rounded-lg border border-line bg-panel-2 p-2 transition-colors focus-within:border-accent/50"
        onSubmit={(e) => {
          e.preventDefault();
          const message = text.trim();
          if (message === "") return;
          void submit({ message });
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入你的回答…"
          maxLength={2000}
          disabled={submitting}
          className="min-h-[36px] flex-1 bg-transparent px-1.5 py-1.5 text-[13px] text-text-1 placeholder:text-text-3 focus:outline-none disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={submitting || text.trim() === ""}
          className="shrink-0 cursor-pointer rounded-md bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          发送
        </button>
      </form>
    </div>
  );
}
