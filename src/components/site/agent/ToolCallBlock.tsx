"use client";
/**
 * 工具调用过程块(K2.5,平移 ai-invest ToolCallBlock,去 antd 化):
 * 默认折叠一行(工具图标 + font-mono 名 + 运行中/已完成);展开看
 * args/result JSON(限高滚动)。result==null 即运行中(assistant-ui 消息
 * 模型在工具完成前不填 result)。
 */
import { useState } from "react";

/** 站内三工具 + 时间/计划工具的图标(sprite 体系,禁手绘) */
const TOOL_ICON: Record<string, string> = {
  search_site: "#i-search",
  read_post: "#i-read",
  read_repo: "#i-github",
  get_time: "#i-clock",
  write_todos: "#i-bars",
};

/** 只取渲染所需子集(assistant-ui 完整 part 含 type/toolCallId/argsText) */
interface ToolCallBlockProps {
  toolName: string;
  args: unknown;
  result?: unknown;
}

export default function ToolCallBlock({
  toolName,
  args,
  result,
}: ToolCallBlockProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const isRunning = result == null;
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-line bg-panel-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs"
      >
        <svg className="ic ic-sm shrink-0 text-accent-hover" aria-hidden="true">
          <use href={TOOL_ICON[toolName] ?? "#i-tool"} />
        </svg>
        <span className="font-mono text-accent-hover">{toolName}</span>
        <span className="ml-auto flex items-center gap-1.5 text-text-3">
          {isRunning ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-line-hover border-t-accent" />
              运行中…
            </>
          ) : (
            "已完成"
          )}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-line px-3 py-2 text-xs text-text-2">
          <div>
            <span className="text-text-3">参数:</span>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[11px] leading-[1.7]">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
          {!isRunning ? (
            <div>
              <span className="text-text-3">结果:</span>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[11px] leading-[1.7]">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
