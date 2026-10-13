"use client";

/**
 * compose_topic_draft 工具卡过程面板(M27 批④,平移 1276 验收反馈「合成要有
 * 过程」):运行中轮询合成状态端点(与专题页按钮同源 GET),四步管线进度
 * 实时滚动(角度择优→起草→自检→修订,worker 上报);完成展示结果摘要与
 * 文档链接,失败/超时如实转述。历史会话回放直接按 result 渲染终态,不轮询。
 */
import { useEffect, useState } from "react";
import Link from "next/link";

/** GET /api/topics/<id>/compose/ 轮询响应(compose-agent TopicComposeState) */
interface ComposeStateData {
  state: "idle" | "queued" | "running" | "done" | "failed";
  progress: { step: number; total: number; label: string; fallback?: boolean } | null;
  result: {
    postId: string;
    postTitle: string;
    recomposed: boolean;
    coverPath: string | null;
    fallback: boolean;
  } | null;
  error: string | null;
}

/** 工具结果 JSON(compose-tool ComposeToolPayload;线序可能是字符串) */
interface ComposeToolResult {
  ok: boolean;
  error?: string;
  needConfirm?: boolean;
  timeout?: boolean;
  postId?: string;
  postTitle?: string;
  postUrl?: string;
  recomposed?: boolean;
  fallback?: boolean;
}

const POLL_INTERVAL_MS = 2500;

function parseResult(result: unknown): ComposeToolResult | null {
  if (result == null) return null;
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as ComposeToolResult;
    } catch {
      return { ok: false, error: result };
    }
  }
  if (typeof result === "object") return result as ComposeToolResult;
  return null;
}

export default function ComposeToolProgress({
  args,
  result,
}: {
  args: unknown;
  result?: unknown;
}): React.ReactElement | null {
  const topicId =
    typeof args === "object" &&
    args !== null &&
    typeof (args as { topic_id?: unknown }).topic_id === "string"
      ? (args as { topic_id: string }).topic_id
      : null;
  const parsed = parseResult(result);
  const [live, setLive] = useState<ComposeStateData | null>(null);

  // 运行中轮询(2.5s,同专题页按钮口径);拿到终态或组件卸载即停
  useEffect(() => {
    if (parsed !== null || topicId === null) return;
    let cancelled = false;
    const fetchOnce = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/topics/${topicId}/compose/`);
        const body = (await res.json()) as { code: number; data?: ComposeStateData };
        if (!cancelled && body.code === 0 && body.data) setLive(body.data);
      } catch {
        /* 网络抖动,下轮再取 */
      }
    };
    void fetchOnce();
    const timer = setInterval(() => void fetchOnce(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [topicId, parsed]);

  if (topicId === null) return null; // args 异常退回默认 JSON 视图

  // ── 终态(工具已返回)──
  if (parsed !== null) {
    if (parsed.ok && parsed.postUrl) {
      return (
        <div className="space-y-0.5 border-t border-line px-3 py-1.5 text-[11px] text-text-2">
          <span className="text-green">
            ✓ {parsed.recomposed ? "已重合成" : "已合成"}《{parsed.postTitle ?? ""}》
            {parsed.fallback ? "(管线降级单调用)" : ""}
          </span>
          <div>
            封面已转存为文章头图 ·{" "}
            <Link href={parsed.postUrl} className="text-accent-hover hover:underline">
              跳转文档(人工定稿)
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-red">
        {parsed.timeout ? "⏱ " : "✗ "}
        {parsed.error ?? "合成失败,请重试"}
      </div>
    );
  }

  // ── 运行中(轮询进度)──
  const progress = live?.progress ?? null;
  const label =
    live === null
      ? "进入合成队列…"
      : live.state === "queued"
        ? "排队中…"
        : progress
          ? `${progress.label}(${progress.step}/${progress.total})`
          : "处理中…";
  return (
    <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-[11px] text-text-2">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-line-hover border-t-accent" />
      <span>{label}</span>
      {progress?.fallback && <span className="text-amber-hi">管线降级单调用</span>}
      <span className="ml-auto text-text-3">四步管线在后台执行,关闭对话框不影响落稿</span>
    </div>
  );
}
