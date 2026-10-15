"use client";

/**
 * 文章列表批量动作 Hook(M31 验收反馈:批量删除;自 PostsTable 抽出):
 * - 批量 SEO 补全 / 批量同步公众号:job 化(202+轮询,batch-job.ts);
 * - 批量删除:同步软删(POST /api/posts/batch-delete,镜像单条语义)。
 * 选择态与按钮渲染留 PostsTable,本模块只管动作与反馈文案。
 */
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { postBatch, outcomeText } from "./batch/batch-client";
import { runBatchJob } from "./batch-job";

/** 轮询 3s × 240 ≈ 12min:50 篇 × LLM 最坏十几秒,先于 worker 锁超时收敛 */
const POLL_MS = 3_000;
const POLL_MAX = 240;

interface PostsBatchOptions {
  selectedIds: string[];
  /** 已同步公众号的选中篇数(覆盖确认用) */
  syncedCount: number;
  clearSelected: () => void;
}

export function usePostsBatchJobs({ selectedIds, syncedCount, clearSelected }: PostsBatchOptions): {
  busy: boolean;
  msg: string | null;
  error: string | null;
  runSeoBatch: () => void;
  runWechatBatch: () => void;
  runDeleteBatch: () => void;
} {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSeoBatch = useCallback((): void => {
    const ids = selectedIds;
    setBusy(true);
    setError(null);
    setMsg(`提交中(共 ${ids.length} 篇)…`);
    void runBatchJob({
      endpoint: "/api/posts/seo-suggest-batch",
      body: { ids },
      pollUrl: (j, t) => `/api/posts/seo-suggest-batch/${j}?token=${encodeURIComponent(t)}`,
      pollMs: POLL_MS,
      pollMax: POLL_MAX,
      timeoutMsg: "轮询超时:任务仍在后台执行,稍后刷新列表查看结果",
      onProgress: (d) =>
        setMsg(
          `补全中 ${d.processed ?? 0}/${d.total ?? ids.length}(跳过 ${d.skipped ?? 0} · 失败 ${
            d.failedIds?.length ?? 0
          })…`,
        ),
      onDone: (d) => {
        const failed = d.failedIds?.length ?? 0;
        const done = (d.total ?? ids.length) - (d.skipped ?? 0) - failed;
        setMsg(`完成:补全 ${done} · 跳过 ${d.skipped ?? 0} · 失败 ${failed}`);
        clearSelected();
        router.refresh();
        setBusy(false);
      },
      onError: (m) => {
        setError(m);
        setMsg(null);
        setBusy(false);
      },
    });
  }, [selectedIds, clearSelected, router]);

  const runWechatBatch = useCallback((): void => {
    const ids = selectedIds;
    if (
      syncedCount > 0 &&
      !window.confirm(
        `选中文章中 ${syncedCount} 篇已同步过公众号,重新同步将覆盖公众号侧草稿内容,继续?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(`提交中(共 ${ids.length} 篇)…`);
    let skipNote = ""; // 预检跳过数由 202 携回(批量进度体只有 processed/total/failedIds)
    void runBatchJob<{
      jobId?: string;
      token?: string;
      eligible?: string[];
      skipped?: Array<{ id: string; reason: string }>;
    }>({
      endpoint: "/api/distribute/wechat/batch",
      body: { ids },
      pollUrl: (j, t) => `/api/distribute/wechat/batch/${j}?token=${encodeURIComponent(t)}`,
      pollMs: POLL_MS,
      pollMax: POLL_MAX,
      timeoutMsg: "轮询超时:任务仍在后台执行,稍后刷新列表或到「内容分发」页查看结果",
      onSubmitted: (d) => {
        if (!d.eligible || d.eligible.length === 0) {
          return `没有可同步的文章:${
            (d.skipped ?? []).map((s) => s.reason).join(";") || "资格预检未通过"
          }`;
        }
        const n = (d.skipped ?? []).length;
        skipNote = n > 0 ? ` · 跳过 ${n}` : "";
        return null;
      },
      onProgress: (d) =>
        setMsg(
          `同步中 ${d.processed ?? 0}/${d.total ?? ids.length}(失败 ${
            d.failedIds?.length ?? 0
          }${skipNote})…`,
        ),
      onDone: (d) => {
        const failed = d.failedIds?.length ?? 0;
        const done = (d.total ?? ids.length) - failed;
        setMsg(`同步完成:成功 ${done} · 失败 ${failed}${skipNote}(失败篇目行内可单篇重试)`);
        clearSelected();
        router.refresh();
        setBusy(false);
      },
      onError: (m) => {
        setError(m);
        setMsg(null);
        setBusy(false);
      },
    });
  }, [selectedIds, syncedCount, clearSelected, router]);

  const runDeleteBatch = useCallback((): void => {
    const ids = selectedIds;
    if (!window.confirm(`确认删除选中的 ${ids.length} 篇文章?删除后前台即刻不可见。`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    void postBatch("/api/posts/batch-delete", { ids }).then((r) => {
      if (r.ok && r.data) {
        setMsg(outcomeText("已删除", r.data));
        clearSelected();
        router.refresh();
      } else {
        setError(r.message ?? "批量删除失败");
      }
      setBusy(false);
    });
  }, [selectedIds, clearSelected, router]);

  return { busy, msg, error, runSeoBatch, runWechatBatch, runDeleteBatch };
}
