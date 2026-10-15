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
import { useEffect, useMemo, useState } from "react";

import AssistantCard from "@/components/site/assistant/AssistantCard";

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
  const [open, setOpen] = useState(false);
  /** 首开后恒挂载:关闭仅隐藏(见 docstring 常驻化) */
  const [everOpened, setEverOpened] = useState(false);

  // 程序化唤起:开卡 + 注入直发消息(AssistantCard injectAsk → pending → append)
  useEffect(() => {
    if (!launch) return;
    setEverOpened(true);
    setOpen(true);
  }, [launch]);

  // injectAsk 引用必须稳定(nonce 门闩,FAB 同 prop 的 state 持有契约):
  // 内联字面量会让 AssistantCard 注入 effect 按引用每渲染重跑——侧栏每次
  // 开关/宿主任意重渲染都重发种子问题(2026-10-15 验收反馈:点机器人按钮
  // 开侧栏即直触文生图的根因)。仅 launch 换新(再次「生成候选」)才换引用。
  const injectAsk = useMemo(
    () => (launch ? { question: launch.question, send: true, nonce: launch.nonce } : null),
    [launch],
  );

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
            injectAsk={injectAsk}
            editContext={{ postId, title, getContent, onApplyContent }}
          />
        </div>
      )}
    </>
  );
}
