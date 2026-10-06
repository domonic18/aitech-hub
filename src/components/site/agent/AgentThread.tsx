"use client";
/**
 * 会话主区(K2.5,平移 ai-invest AssistantThread):消息流(MessagePrimitive,
 * tools.Fallback→ToolCallBlock,正文 AnswerMarkdown 受约束渲染)、历史骨架、
 * 运行中跳动点、末条消息中断提示。程序化发送直写 thread.append——
 * composer.setText 经 flushTapSync 延迟生效,同 tick 的 send 会静默 no-op。
 */
import { AuiIf, MessagePrimitive, ThreadPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { useCallback, useEffect } from "react";

import AnswerMarkdown from "@/components/site/search/AnswerMarkdown";

import AgentComposer from "./AgentComposer";
import ToolCallBlock from "./ToolCallBlock";

export interface PendingAsk {
  question: string;
  /** true=直发(答案卡追问 chips);false=仅预填输入框(「继续深挖」按钮) */
  send: boolean;
}

function MessageText({ text }: { text: string }): React.ReactElement {
  // Drawer 无引用列表,角标渲染纯上标(citeLinks=false)
  return (
    <div className="text-[13.5px] leading-[1.8] text-text-1">
      <AnswerMarkdown text={text} citeLinks={false} />
    </div>
  );
}

function ToolCall({ toolName, args, result }: ToolCallMessagePartProps): React.ReactElement {
  return <ToolCallBlock toolName={toolName} args={args} result={result} />;
}

function UserMessage(): React.ReactElement {
  return (
    <MessagePrimitive.Root className="mb-4 flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-accent px-3.5 py-2 text-[13px] leading-[1.7] text-white">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage(): React.ReactElement {
  return (
    <MessagePrimitive.Root className="group mb-4">
      <div className="min-w-0 space-y-1">
        <MessagePrimitive.Content
          components={{
            Text: MessageText,
            tools: { Fallback: ToolCall },
          }}
        />
        {/* 流式生成中的闪烁光标 */}
        <AuiIf condition={(s) => s.message.status?.type === "running"}>
          <span className="ml-0.5 inline-block h-4 w-[7px] translate-y-[3px] animate-pulse rounded-sm bg-green-hi/80" />
        </AuiIf>
        {/* wire error 帧 → 末条 AI 消息 incomplete/error:人话提示 */}
        <AuiIf condition={(s) => s.message.status?.type === "incomplete"}>
          <div className="mt-1 font-mono text-[11px] text-amber-hi">
            ⚠ 响应已中断(护栏收束或服务异常),可重试或换问法
          </div>
        </AuiIf>
      </div>
    </MessagePrimitive.Root>
  );
}

function HistorySkeleton(): React.ReactElement {
  return (
    <div aria-busy="true" aria-label="正在加载会话记录">
      {[0, 1].map((round) => (
        <div key={round} className="mb-5">
          <div className="mb-4 flex justify-end">
            <div
              className="h-8 animate-pulse rounded-lg bg-panel-2"
              style={{ width: round === 0 ? 150 : 110 }}
            />
          </div>
          <div className="space-y-2">
            {[64, 92, 76].map((w, i) => (
              <div
                key={i}
                className="h-3.5 animate-pulse rounded bg-panel-2"
                style={{ width: `${Math.min(100, w + round * 8)}%`, animationDelay: `${i * 90}ms` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 程序化发送/预填:pending 就绪(非加载非运行)即消费,避免预置问题被静默丢弃 */
function PendingAskSender({
  pending,
  onConsumed,
}: {
  pending: PendingAsk | null;
  onConsumed: () => void;
}): React.ReactElement | null {
  const aui = useAui();
  const isLoading = useAuiState((s) => s.thread.isLoading);
  const isRunning = useAuiState((s) => s.thread.isRunning);

  useEffect(() => {
    if (!pending || isLoading || isRunning) return;
    if (pending.send) {
      aui.thread.append(pending.question);
    } else {
      aui.thread.composer().setText(pending.question);
    }
    onConsumed();
  }, [pending, isLoading, isRunning, aui, onConsumed]);
  return null;
}

/** 运行中反馈:三个跳动点(跟在末条消息下方) */
function TypingIndicator(): React.ReactElement | null {
  return (
    <ThreadPrimitive.If running>
      <div className="mb-4" aria-label="助手正在处理">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-3"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </div>
      </div>
    </ThreadPrimitive.If>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <div className="py-12 text-center font-mono text-xs leading-[2] text-text-3">
      <svg className="ic ic-lg mx-auto mb-3 text-text-3" aria-hidden="true">
        <use href="#i-robot" />
      </svg>
      $ agent.digest --thread=new
      <br />
      围绕搜索结果多轮深挖:对比 / 展开 / 归纳站内内容
    </div>
  );
}

interface AgentThreadProps {
  pending: PendingAsk | null;
  onPendingConsumed: () => void;
}

export default function AgentThread({
  pending,
  onPendingConsumed,
}: AgentThreadProps): React.ReactElement {
  const isLoading = useAuiState((s) => s.thread.isLoading);
  // 计划条由 Drawer 承载(横贯侧栏+主区),此处仅消息流编排
  const onConsumed = useCallback(() => onPendingConsumed(), [onPendingConsumed]);

  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <HistorySkeleton />
        ) : (
          <>
            <ThreadPrimitive.Empty>
              <EmptyState />
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
            <TypingIndicator />
          </>
        )}
      </ThreadPrimitive.Viewport>
      <AgentComposer />
      <PendingAskSender pending={pending} onConsumed={onConsumed} />
    </ThreadPrimitive.Root>
  );
}
