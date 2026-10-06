"use client";

/**
 * 文章管理列表主体(M16 问题8 抽出为客户端组件):行多选 + 批量 SEO 补全
 * (仅补空缺)批量条与进度轮询;行内容/行内操作与原 RSC 表格一致。
 * M17 批④:批量条加「同步公众号」(wechatReady=false 禁用+指引;预检 skipped
 * 202 携回人话);行操作透传 sync 视图开 SyncWechatDialog。
 * 分页由 RSC 页面以 children 注入(AdminPagination 需服务端 hrefFor 函数,
 * 不能跨客户端边界)。轮询直至 completed/failed;完成即 router.refresh 重拉
 * 本页 RSC(SEO 列为只读展示,刷新后无可见变化亦无副作用)。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import PostRowOps from "./PostRowOps";
import PostStatusBadge from "./PostStatusBadge";
import type { PostDisplayState } from "@/lib/content/post-schema";
import { DISTRIBUTE_BATCH_MAX } from "@/lib/distribute/channels";
import { formatCnDateTime } from "@/lib/datetime";
import type { ApiEnvelope } from "@/lib/http/response";

export interface PostsTableRowView {
  id: string;
  title: string;
  state: PostDisplayState;
  legacy: boolean;
  pathSegment: string;
  sitePath: string;
  categoryName: string;
  tagNames: string[];
  viewsCount: number;
  publishedAt: Date | null;
  coverPath: string | null;
  seoTitle: string | null;
  excerpt: string | null;
  seoDescription: string | null;
  syncable: boolean;
  wechat: { status: string } | null;
}

/** 轮询 3s × 240 ≈ 12min:50 篇 × LLM 最坏十几秒,先于 worker 锁超时收敛 */
const POLL_MS = 3_000;
const POLL_MAX = 240;

type BatchPollBody = ApiEnvelope<{
  state?: "waiting" | "active" | "completed" | "failed";
  error?: string | null;
  processed?: number;
  total?: number;
  skipped?: number;
  failedIds?: string[];
} | null>;

export default function PostsTable({
  rows,
  wechatReady,
  children,
}: {
  rows: PostsTableRowView[];
  wechatReady: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runSeoBatch(): Promise<void> {
    const ids = [...selected];
    setBatchBusy(true);
    setBatchError(null);
    setBatchMsg(`提交中(共 ${ids.length} 篇)…`);
    try {
      const res = await fetch("/api/posts/seo-suggest-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const json = (await res.json().catch(() => null)) as ApiEnvelope<{
        jobId?: string;
        token?: string;
      }> | null;
      if (!res.ok || json?.code !== 0 || !json.data?.jobId || !json.data?.token) {
        setBatchError(json?.message ?? `提交失败(${res.status})`);
        setBatchMsg(null);
        setBatchBusy(false);
        return;
      }
      const { jobId, token } = json.data;
      for (let i = 0; i < POLL_MAX; i += 1) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const poll = await fetch(
          `/api/posts/seo-suggest-batch/${jobId}?token=${encodeURIComponent(token)}`,
        );
        if (!poll.ok) continue;
        const body = (await poll.json().catch(() => null)) as BatchPollBody | null;
        if (body?.code !== 0 || !body?.data) continue;
        const d = body.data;
        if (d.state === "completed") {
          const failed = d.failedIds?.length ?? 0;
          const done = (d.total ?? ids.length) - (d.skipped ?? 0) - failed;
          setBatchMsg(`完成:补全 ${done} · 跳过 ${d.skipped ?? 0} · 失败 ${failed}`);
          setSelected(new Set());
          router.refresh();
          setBatchBusy(false);
          return;
        }
        if (d.state === "failed") {
          setBatchError(d.error ?? "批量任务失败");
          setBatchMsg(null);
          setBatchBusy(false);
          return;
        }
        setBatchMsg(
          `补全中 ${d.processed ?? 0}/${d.total ?? ids.length}(跳过 ${d.skipped ?? 0} · 失败 ${
            d.failedIds?.length ?? 0
          })…`,
        );
      }
      setBatchError("轮询超时:任务仍在后台执行,稍后刷新列表查看结果");
      setBatchBusy(false);
    } catch {
      setBatchError("网络错误,请重试");
      setBatchMsg(null);
      setBatchBusy(false);
    }
  }

  /** 批量同步公众号(M17 批④):预检 skipped 由 202 携回人话;进度 processed/failedIds */
  async function runWechatBatch(): Promise<void> {
    const ids = [...selected];
    const syncedCount = rows.filter(
      (r) => ids.includes(r.id) && r.wechat?.status === "synced",
    ).length;
    if (
      syncedCount > 0 &&
      !window.confirm(
        `选中文章中 ${syncedCount} 篇已同步过公众号,重新同步将覆盖公众号侧草稿内容,继续?`,
      )
    ) {
      return;
    }
    setBatchBusy(true);
    setBatchError(null);
    setBatchMsg(`提交中(共 ${ids.length} 篇)…`);
    try {
      const res = await fetch("/api/distribute/wechat/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const json = (await res.json().catch(() => null)) as ApiEnvelope<{
        jobId?: string;
        token?: string;
        eligible?: string[];
        skipped?: Array<{ id: string; reason: string }>;
      }> | null;
      if (!res.ok || json?.code !== 0 || !json.data?.jobId || !json.data?.token) {
        setBatchError(json?.message ?? `提交失败(${res.status})`);
        setBatchMsg(null);
        setBatchBusy(false);
        return;
      }
      const { jobId, token, eligible, skipped } = json.data;
      if (!eligible || eligible.length === 0) {
        setBatchMsg(null);
        setBatchError(
          `没有可同步的文章:${(skipped ?? []).map((s) => s.reason).join(";") || "资格预检未通过"}`,
        );
        setBatchBusy(false);
        return;
      }
      const skipNote = (skipped ?? []).length > 0 ? ` · 跳过 ${skipped?.length}` : "";
      for (let i = 0; i < POLL_MAX; i += 1) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const poll = await fetch(
          `/api/distribute/wechat/batch/${jobId}?token=${encodeURIComponent(token)}`,
        );
        if (!poll.ok) continue;
        const body = (await poll.json().catch(() => null)) as BatchPollBody | null;
        if (body?.code !== 0 || !body?.data) continue;
        const d = body.data;
        if (d.state === "completed") {
          const failed = d.failedIds?.length ?? 0;
          const done = (d.total ?? ids.length) - failed;
          setBatchMsg(`同步完成:成功 ${done} · 失败 ${failed}${skipNote}(失败篇目行内可单篇重试)`);
          setSelected(new Set());
          router.refresh();
          setBatchBusy(false);
          return;
        }
        if (d.state === "failed") {
          setBatchError(d.error ?? "批量同步任务失败");
          setBatchMsg(null);
          setBatchBusy(false);
          return;
        }
        setBatchMsg(
          `同步中 ${d.processed ?? 0}/${d.total ?? ids.length}(失败 ${
            d.failedIds?.length ?? 0
          }${skipNote})…`,
        );
      }
      setBatchError("轮询超时:任务仍在后台执行,稍后刷新列表或到「内容分发」页查看结果");
      setBatchBusy(false);
    } catch {
      setBatchError("网络错误,请重试");
      setBatchMsg(null);
      setBatchBusy(false);
    }
  }

  const showBatchBar = selected.size > 0 || batchMsg !== null || batchError !== null;

  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      {showBatchBar && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-accent-dim/40 px-4 py-2.5 text-xs">
          <span className="text-text-2">
            已选 <b className="text-text-1">{selected.size}</b> 篇
          </span>
          <button
            type="button"
            disabled={batchBusy || selected.size === 0}
            onClick={() => void runSeoBatch()}
            title="对选中文章调用 LLM 生成缺失的 SEO 标题/描述;已有值不覆盖"
            className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {batchBusy ? "批量补全中…" : "批量 SEO 补全(仅补空缺)"}
          </button>
          <button
            type="button"
            disabled={batchBusy || !wechatReady}
            onClick={() => void runWechatBatch()}
            title={
              wechatReady
                ? `推送选中文章到公众号草稿箱(单批 ≤${DISTRIBUTE_BATCH_MAX} 篇,顺序逐篇)`
                : "先到「内容分发」完成公众号配置并启用渠道"
            }
            className="cursor-pointer rounded-sm border border-accent/50 bg-transparent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-60"
          >
            {batchBusy ? "同步中…" : "同步公众号"}
          </button>
          {!batchBusy && selected.size > 0 && (
            <button
              type="button"
              className="cursor-pointer text-text-3 hover:text-text-1"
              onClick={() => setSelected(new Set())}
            >
              取消选择
            </button>
          )}
          {batchMsg && <span className="text-accent">{batchMsg}</span>}
          {batchError && <span className="text-red">{batchError}</span>}
        </div>
      )}

      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
            <th className="w-10 px-3 py-2.5">
              <input
                type="checkbox"
                aria-label="全选本页"
                className="accent-[var(--accent)]"
                checked={allSelected}
                onChange={toggleAll}
                disabled={rows.length === 0}
              />
            </th>
            <th className="px-4 py-2.5 font-medium">文章</th>
            <th className="px-3 py-2.5 font-medium">分类 / 标签</th>
            <th className="px-3 py-2.5 font-medium">状态</th>
            <th className="px-3 py-2.5 text-right font-medium">浏览</th>
            <th className="px-3 py-2.5 font-medium">发布时间</th>
            <th className="px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={`border-b border-line last:border-b-0 ${
                row.legacy ? "bg-panel-2" : "hover:bg-panel-2"
              }`}
            >
              <td className="px-3 py-3">
                <input
                  type="checkbox"
                  aria-label={`选择 ${row.title}`}
                  className="accent-[var(--accent)]"
                  checked={selected.has(row.id)}
                  onChange={() => toggle(row.id)}
                />
              </td>
              <td className="max-w-[420px] px-4 py-3">
                {/* 点击标题 = 查看正文(admin 预览页,草稿/已发布均可看);编辑走右侧按钮 */}
                <Link
                  href={`/admin/posts/${row.id}/preview`}
                  className={`block truncate font-medium hover:text-accent ${
                    row.legacy ? "text-text-2" : "text-text-1"
                  }`}
                >
                  {row.title}
                  {row.legacy && (
                    <span className="ml-2 rounded-sm border border-line bg-line px-1 py-px align-middle text-[10px] text-text-3">
                      旧文保真
                    </span>
                  )}
                </Link>
                <div
                  className="mt-0.5 truncate font-mono text-[11px] text-text-3"
                  title={row.sitePath}
                >
                  /post/{row.pathSegment} · {row.legacy ? "WP 迁移(HTML)" : "新建(Markdown)"}
                  {/* 前台仅 published 可见:草稿/下架不渲染入口,避免视口预取打出 404 RSC 噪音;
                      published 也关预取(新窗口偶发访问,不值得预取流量) */}
                  {row.state === "published" && (
                    <Link
                      href={row.sitePath}
                      target="_blank"
                      prefetch={false}
                      className="ml-2 text-text-3 underline decoration-dotted hover:text-accent"
                    >
                      前台查看
                    </Link>
                  )}
                </div>
              </td>
              {/* 原型 .tag-mini:分类绿描边(tm-cat),标签 accent(tm-tag) */}
              <td className="px-3 py-3">
                <span className="rounded-sm border border-green/35 bg-green/10 px-1.5 py-0.5 text-[11px] text-green">
                  {row.categoryName}
                </span>
                {row.tagNames.map((name) => (
                  <span
                    key={name}
                    className="ml-1 rounded-sm border border-accent/30 bg-accent-dim px-1.5 py-0.5 text-[11px] text-accent"
                  >
                    {name}
                  </span>
                ))}
              </td>
              <td className="px-3 py-3">
                <PostStatusBadge state={row.state} />
              </td>
              <td className="px-3 py-3 text-right font-mono text-xs">
                {row.viewsCount.toLocaleString("en-US")}
              </td>
              <td className="px-3 py-3 font-mono text-xs text-text-2">
                {row.publishedAt ? formatCnDateTime(row.publishedAt) : "—"}
              </td>
              <td className="px-4 py-3 text-right">
                <PostRowOps
                  id={row.id}
                  title={row.title}
                  state={row.state}
                  legacy={row.legacy}
                  wechatReady={wechatReady}
                  sync={{
                    coverPath: row.coverPath,
                    seoTitle: row.seoTitle,
                    excerpt: row.excerpt,
                    seoDescription: row.seoDescription,
                    syncable: row.syncable,
                    wechat: row.wechat,
                  }}
                />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-xs text-text-3">
                没有符合条件的文章
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {children}
    </div>
  );
}
