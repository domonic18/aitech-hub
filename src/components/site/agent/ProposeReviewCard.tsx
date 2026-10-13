"use client";
/**
 * 改稿提案评审面(M27 批⑧-d,@codemirror/merge + diff-match-patch):
 * propose_edits 中断在编辑页嵌入形态(带 getContent/onApplyContent 接线)的
 * 评审模态。提案不落笔:应用 = mergeProposals 以 getContent() 快照为基合成
 * 新全文 → onApplyContent 写回编辑器(既有 setValue/自动保存链)→ resume
 * {decision,applied,comment} 回灌工具体(applied=全接受,partial=部分)。
 * 全屏遮罩即评审互斥(编辑器无法同时改动,免 readOnly 接线);rewrite 档走
 * MergeView 双栏对照(动态 import 按需加载);edits 档逐块卡片 + dmp 词级
 * diff,默认全接受、逐块可弃。无「关闭」钮——中断必须以拒绝或应用收束,
 * 弃评会悬挂线程。
 */
import { useLangGraphSendCommand, type LangGraphCommand } from "@assistant-ui/react-langgraph";
import { diff_match_patch } from "diff-match-patch";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildProposeEditsResumeCommand,
  type ProposeEditsPayload,
  type ProposeEditsResume,
} from "@/lib/agent/edit-proposal";
import { locateProposals, mergeProposals } from "@/lib/content/proposal-apply";

/** 定位状态徽标(终端风 token) */
const STATUS_BADGE = {
  exact: { label: "精确定位", cls: "border-green/40 bg-green/10 text-green-hi" },
  fuzzy: { label: "模糊匹配", cls: "border-amber/40 bg-amber/10 text-amber-hi" },
  miss: { label: "未定位", cls: "border-red/40 bg-red/10 text-red-hi" },
} as const;

/** 词级语义 diff(删除红删除线 / 新增绿),S/R 块正文渲染 */
function DiffSpans({ before, after }: { before: string; after: string }): React.ReactElement {
  const spans = useMemo(() => {
    const dmp = new diff_match_patch();
    const diffs = dmp.diff_main(before, after);
    dmp.diff_cleanupSemantic(diffs);
    return diffs;
  }, [before, after]);
  return (
    <>
      {spans.map(([op, text], i) =>
        op === -1 ? (
          <del key={i} className="bg-red/10 text-red-hi line-through">
            {text}
          </del>
        ) : op === 1 ? (
          <ins key={i} className="bg-green/10 text-green-hi no-underline">
            {text}
          </ins>
        ) : (
          <span key={i}>{text}</span>
        ),
      )}
    </>
  );
}

function ChunkCard({
  chunk,
  accepted,
  onToggle,
}: {
  chunk: ReturnType<typeof locateProposals>[number];
  accepted: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const badge = STATUS_BADGE[chunk.status];
  const missed = chunk.status === "miss";
  return (
    <div
      className={`rounded-md border p-2.5 ${missed ? "border-red/30 opacity-70" : "border-line"}`}
    >
      <div className="mb-1.5 flex items-center gap-2 text-[11px]">
        <span className="font-mono text-text-3">#{chunk.index + 1}</span>
        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 ${badge.cls}`}>
          {badge.label}
        </span>
        {chunk.note && <span className="truncate text-text-3">{chunk.note}</span>}
        {!missed && (
          <button
            type="button"
            onClick={onToggle}
            className={`ml-auto shrink-0 cursor-pointer rounded border px-2 py-0.5 transition-colors ${
              accepted
                ? "border-green/50 text-green-hi"
                : "border-line text-text-3 hover:text-text-1"
            }`}
          >
            {accepted ? "已接受" : "已放弃"}
          </button>
        )}
      </div>
      <div className="whitespace-pre-wrap break-all font-mono text-xs leading-[1.7] text-text-1">
        <DiffSpans before={chunk.oldString} after={chunk.newString} />
      </div>
    </div>
  );
}

interface ProposeReviewCardProps {
  payload: ProposeEditsPayload;
  /** 评审基线(挂载瞬间快照一次) */
  getContent: () => string;
  /** 应用出口(写回编辑器 → 自动保存链) */
  onApplyContent: (md: string) => void;
}

export default function ProposeReviewCard({
  payload,
  getContent,
  onApplyContent,
}: ProposeReviewCardProps): React.ReactElement {
  const sendCommand = useLangGraphSendCommand();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  // 评审基线快照(仅挂载时取一次;遮罩互斥保证期间编辑器不变)
  const [original] = useState(() => getContent());
  const chunks = useMemo(
    () => (payload.mode === "edits" ? locateProposals(original, payload.edits ?? []) : []),
    [payload, original],
  );
  // 默认全接受,逐块可弃;「全部接受」= 清空弃用集
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => new Set());
  const acceptedCount = chunks.filter((c) => c.status !== "miss" && !excluded.has(c.index)).length;
  const missCount = chunks.filter((c) => c.status === "miss").length;
  const locatedCount = chunks.length - missCount;

  // rewrite 档双栏对照(MergeView 动态 import:评审面不常驻 bundle)
  const mergeHostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (payload.mode !== "rewrite") return;
    let view: { destroy: () => void } | null = null;
    let cancelled = false;
    void (async () => {
      const [{ MergeView }, { EditorView }, { markdown }] = await Promise.all([
        import("@codemirror/merge"),
        import("@codemirror/view"),
        import("@codemirror/lang-markdown"),
      ]);
      if (cancelled || mergeHostRef.current === null) return;
      const readOnly = [EditorView.editable.of(false), EditorView.lineWrapping];
      view = new MergeView({
        a: { doc: original, extensions: [markdown(), ...readOnly] },
        b: { doc: payload.contentMd ?? "", extensions: [markdown(), ...readOnly] },
        parent: mergeHostRef.current,
      });
    })();
    return () => {
      cancelled = true;
      view?.destroy();
    };
  }, [payload, original]);

  const resume = async (r: ProposeEditsResume): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await sendCommand(buildProposeEditsResumeCommand(r) as unknown as LangGraphCommand);
    } catch {
      setError("回执发送失败,请重试");
      setSubmitting(false);
    }
  };

  /** 评语 + 自动注记(未定位/未接受块数,agent 据此迭代) */
  const composeComment = (notes: string[]): string | undefined => {
    const all = [comment.trim(), ...notes].filter((s) => s !== "");
    return all.length > 0 ? all.join(";") : undefined;
  };

  const onApply = (): void => {
    if (payload.mode === "rewrite") {
      onApplyContent(payload.contentMd ?? "");
      void resume({ decision: "applied", comment: composeComment([]) });
      return;
    }
    const accepted = new Set(
      chunks.filter((c) => c.status !== "miss" && !excluded.has(c.index)).map((c) => c.index),
    );
    onApplyContent(mergeProposals(original, chunks, accepted));
    const notes: string[] = [];
    if (missCount > 0) notes.push(`${missCount} 块未能在原文定位(oldString 请含更多上下文)`);
    const dropped = chunks.length - acceptedCount - missCount;
    if (dropped > 0) notes.push(`${dropped} 块被管理员放弃`);
    void resume({
      decision: acceptedCount === chunks.length ? "applied" : "partial",
      applied: acceptedCount,
      comment: composeComment(notes),
    });
  };

  const onReject = (): void => {
    void resume({
      decision: "rejected",
      comment: composeComment(missCount > 0 ? [`${missCount} 块未能在原文定位`] : []),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="改稿提案评审"
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-bg shadow-lg">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="font-mono text-[13px] text-text-1">提案评审</span>
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] text-text-3">
            {payload.mode === "rewrite" ? "整档重写" : `局部修改 ${chunks.length} 块`}
          </span>
          <span className="ml-auto hidden font-mono text-[10.5px] text-text-3 sm:inline">
            提案不落笔 · 接受后写入编辑器
          </span>
        </header>
        <p className="shrink-0 border-b border-line bg-panel-2/60 px-4 py-2 text-[13px] leading-[1.7] text-text-2">
          {payload.note}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {payload.mode === "rewrite" ? (
            <div
              ref={mergeHostRef}
              aria-label="全文对照(左原文/右提案)"
              className="max-h-[60vh] overflow-auto rounded-md border border-line text-xs"
            />
          ) : (
            <div className="space-y-2.5">
              {chunks.map((c) => (
                <ChunkCard
                  key={c.index}
                  chunk={c}
                  accepted={c.status !== "miss" && !excluded.has(c.index)}
                  onToggle={() => {
                    setExcluded((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.index)) next.delete(c.index);
                      else next.add(c.index);
                      return next;
                    });
                  }}
                />
              ))}
            </div>
          )}
        </div>
        <footer className="shrink-0 space-y-2 border-t border-line p-3">
          {error && <p className="text-xs text-red-hi">{error}</p>}
          <div className="flex items-center gap-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="评语(可选,随回执告诉助手)"
              maxLength={2000}
              disabled={submitting}
              className="min-h-[34px] flex-1 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs text-text-1 placeholder:text-text-3 focus:border-accent/50 focus:outline-none disabled:opacity-40"
            />
            <button
              type="button"
              onClick={onReject}
              disabled={submitting}
              className="shrink-0 cursor-pointer rounded-md border border-red/40 px-3 py-1.5 text-xs text-red-hi transition-colors hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              拒绝提案
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={submitting || (payload.mode === "edits" && acceptedCount === 0)}
              className="shrink-0 cursor-pointer rounded-md bg-accent px-3 py-1.5 text-xs text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {payload.mode === "rewrite"
                ? "应用重写"
                : `应用所选(${acceptedCount}/${locatedCount} 块)`}
            </button>
          </div>
          {payload.mode === "edits" && excluded.size > 0 && (
            <button
              type="button"
              onClick={() => setExcluded(new Set())}
              disabled={submitting}
              className="cursor-pointer font-mono text-[10.5px] text-text-3 hover:text-text-1 disabled:cursor-default disabled:opacity-40"
            >
              全部接受(清空弃用集 {excluded.size} 块)
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
