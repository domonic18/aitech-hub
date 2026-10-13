"use client";

/**
 * 专题合成操作区(M26 批④建;M27 批③ agent 化改异步轮询):POST 入队(202)
 * → GET 轮询进度(角度择优→起草→自检→修订,约 1~3 分钟)→ done 刷新取草稿。
 * 重合成保护 409 needConfirm 的 confirm 二次确认;未绑模型 400 人话行内展示;
 * 同专题进行中 409 拒重。轮询上限 6 分钟,超时提示自行刷新(任务仍在跑)。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";

interface ComposeResponse {
  code: number;
  message: string;
  data?: { postId?: string; recomposed?: boolean; needConfirm?: boolean; jobId?: string };
}

/** GET 轮询响应(compose-agent TopicComposeState 序列化) */
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

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_MS = 6 * 60_000;

export default function TopicComposeActions({
  topicId,
  linkedPostId,
  linkedPostStatus,
  editedSinceCompose,
}: {
  topicId: string;
  linkedPostId: string | null;
  /** 关联文档状态(重合成提示口径:published 覆盖即上线内容变更) */
  linkedPostStatus: string | null;
  /** 服务端预判:合成后被人工编辑过(按钮 title 提示,实际判定以 409 为准) */
  editedSinceCompose: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [postId, setPostId] = useState<string | null>(linkedPostId);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 离开页面即停轮询(任务本身在 worker 继续,回页可再看结果)
  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  async function fetchState(): Promise<ComposeStateData> {
    const res = await fetch(`/api/topics/${topicId}/compose/`);
    const body = (await res.json()) as ApiEnvelope<ComposeStateData>;
    return body.data ?? { state: "idle", progress: null, result: null, error: null };
  }

  /** 轮询至终态;返回 true=取到终态(含失败),false=超时放弃 */
  async function pollUntilDone(startedAt: number): Promise<boolean> {
    const state = await fetchState();
    if (state.state === "done" && state.result) {
      setPostId(state.result.postId);
      setProgressText(null);
      setMsg({
        tone: "ok",
        text:
          (state.result.recomposed ? "已重合成(覆盖原文档)" : "已合成初稿") +
          (state.result.coverPath ? ";视频封面已转存为文章头图" : "") +
          (state.result.fallback ? "(管线降级单调用)" : ""),
      });
      router.refresh();
      return true;
    }
    if (state.state === "failed") {
      setProgressText(null);
      setMsg({ tone: "err", text: state.error ?? "合成失败,请重试" });
      return true;
    }
    if (Date.now() - startedAt > POLL_MAX_MS) {
      setProgressText(null);
      setMsg({ tone: "err", text: "合成耗时较长,已停止等待;任务仍在后台运行,稍后刷新页面查看" });
      return false;
    }
    setProgressText(
      state.progress
        ? `${state.progress.label}(${state.progress.step}/${state.progress.total})…`
        : "排队中…",
    );
    pollTimer.current = setTimeout(() => void pollUntilDone(startedAt), POLL_INTERVAL_MS);
    return false;
  }

  async function call(confirm: boolean): Promise<ComposeResponse & { ok: boolean }> {
    const res = await fetch(`/api/topics/${topicId}/compose/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(confirm ? { confirm: true } : {}),
    });
    const body = (await res.json()) as ComposeResponse;
    return { ...body, ok: res.ok && body.code === 0 };
  }

  async function compose(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setProgressText("进入合成队列…");
    try {
      let r = await call(false);
      if (r.code === 409 && r.data?.needConfirm) {
        if (!window.confirm(r.message)) {
          setMsg({ tone: "err", text: "已取消重合成(人工改动保留)" });
          setProgressText(null);
          return;
        }
        r = await call(true);
      }
      if (!r.ok) {
        setMsg({ tone: "err", text: r.message || `合成失败(${r.code})` });
        setProgressText(null);
        return;
      }
      await pollUntilDone(Date.now());
    } catch {
      setMsg({ tone: "err", text: "网络异常,请重试" });
      setProgressText(null);
    } finally {
      setBusy(false);
    }
  }

  const hasDoc = postId !== null;

  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void compose()}
          disabled={busy}
          className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
          title={
            editedSinceCompose
              ? linkedPostStatus === "published"
                ? "关联文档已发布且被编辑过,重合成将覆盖线上内容"
                : "关联文档在合成后被人工编辑过,重合成将二次确认"
              : undefined
          }
        >
          {busy ? "AI 合成中…" : hasDoc ? "重合成(覆盖文档)" : "合成初稿"}
        </button>
        {hasDoc && (
          <Link
            href={`/admin/posts/${postId}`}
            className="rounded-sm border border-line px-2.5 py-1 text-xs text-text-2 hover:border-accent hover:text-text-1"
          >
            跳转文档(人工定稿)
          </Link>
        )}
        <span className="text-[11px] text-text-3">
          需在 AI 配置绑定「专题合成」模型;AI 四步生成(角度→起草→自检→修订),约 1~3 分钟
        </span>
      </div>
      {progressText && <span className="text-[11px] text-text-2">{progressText}</span>}
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
