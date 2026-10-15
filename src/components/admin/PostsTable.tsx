"use client";

/**
 * 文章管理列表主体(M16 问题8 抽出为客户端组件):行多选 + 批量条(批量 SEO
 * 补全 / 同步公众号 / 批量删除 M31)+ 行内容与行内操作。批量动作 Hook 在
 * posts-batch.ts(SEO/公众号 job 化轮询;删除同步软删);批量条视觉收口为
 * 共享 BatchActionBar。分页由 RSC 页面以 children 注入(AdminPagination 需
 * 服务端 hrefFor 函数,不能跨客户端边界)。
 */
import Link from "next/link";

import BatchButton from "./batch/BatchButton";
import BatchActionBar from "./batch/BatchActionBar";
import { RowCheckbox, SelectAllTh } from "./batch/SelectionCheckbox";
import { useBatchSelection } from "./batch/useBatchSelection";
import { usePostsBatchJobs } from "./posts-batch";
import PostRowOps from "./PostRowOps";
import PostStatusBadge from "./PostStatusBadge";
import type { PostDisplayState } from "@/lib/content/post-schema";
import { DISTRIBUTE_BATCH_MAX } from "@/lib/distribute/channels";
import { formatCnDateTime } from "@/lib/datetime";

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

export default function PostsTable({
  rows,
  wechatReady,
  children,
}: {
  rows: PostsTableRowView[];
  wechatReady: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  const rowIds = rows.map((r) => r.id);
  const { selected, allSelected, toggle, toggleAll, clear } = useBatchSelection(rowIds);
  const syncedCount = rows.filter(
    (r) => selected.has(r.id) && r.wechat?.status === "synced",
  ).length;
  const { busy, msg, error, runSeoBatch, runWechatBatch, runDeleteBatch } = usePostsBatchJobs({
    selectedIds: [...selected],
    syncedCount,
    clearSelected: clear,
  });

  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      <BatchActionBar
        unit="篇"
        count={selected.size}
        busy={busy}
        msg={msg}
        error={error}
        onCancel={clear}
      >
        <BatchButton
          variant="primary"
          label="批量 SEO 补全(仅补空缺)"
          busyLabel="批量补全中…"
          busy={busy}
          disabled={busy || selected.size === 0}
          title="对选中文章调用 LLM 生成缺失的 SEO 标题/描述;已有值不覆盖"
          onClick={runSeoBatch}
        />
        <BatchButton
          variant="outline"
          label="同步公众号"
          busyLabel="同步中…"
          busy={busy}
          disabled={busy || !wechatReady}
          title={
            wechatReady
              ? `推送选中文章到公众号草稿箱(单批 ≤${DISTRIBUTE_BATCH_MAX} 篇,顺序逐篇)`
              : "先到「内容分发」完成公众号配置并启用渠道"
          }
          onClick={runWechatBatch}
        />
        <BatchButton
          variant="danger"
          label="批量删除"
          busyLabel="删除中…"
          busy={busy}
          disabled={busy || selected.size === 0}
          title="软删选中文章:前台即刻不可见,与单条删除同语义"
          onClick={runDeleteBatch}
        />
      </BatchActionBar>

      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
            <SelectAllTh
              allSelected={allSelected}
              disabled={rows.length === 0}
              onToggle={toggleAll}
            />
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
                <RowCheckbox
                  label={`选择 ${row.title}`}
                  checked={selected.has(row.id)}
                  onToggle={() => toggle(row.id)}
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
