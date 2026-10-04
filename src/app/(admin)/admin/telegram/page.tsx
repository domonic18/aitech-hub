/**
 * 电报流治理页(M7 批④,侧栏「电报流治理」;原型 admin-telegram):
 * 四分段 + 来源/媒体筛选 + 搜索 + 分页;行内 恢复/隐藏/归档/编辑;
 * filter_hit 命中徽章即误杀观测。页尾屏蔽词管理。
 * M8 批⑦:媒体列与视频行(封面/平台·博主/互动/时长/原视频链;
 * AI 解读态随解读批,以灰字注记如实呈现,不伪装)。
 */
import Link from "next/link";

import BlocklistManager from "@/components/admin/BlocklistManager";
import TelegramRowOps from "@/components/admin/TelegramRowOps";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { pageWindow, parseListSegment, parsePage } from "@/lib/admin/list";
import {
  TELEGRAM_PAGE_SIZE,
  TELEGRAM_LIST_SEGMENTS,
  listTelegramAdmin,
  type TelegramListSegment,
} from "@/lib/telegram/telegram-admin";
import { listBlocklist } from "@/lib/telegram/blocklist-admin";
import {
  FEED_MEDIA_FILTERS,
  compactCount,
  formatDuration,
  platformLabel,
  type FeedMediaFilter,
} from "@/lib/telegram/feed-view";

export const dynamic = "force-dynamic";

const SEG_LABELS: Record<TelegramListSegment, string> = {
  all: "全部",
  visible: "可见",
  hidden: "隐藏",
  archived: "归档",
};

const MEDIA_LABELS: Record<FeedMediaFilter, string> = {
  all: "全部媒体",
  text: "文字",
  video: "短视频",
};

interface PageProps {
  searchParams: Promise<{
    status?: string;
    page?: string;
    q?: string;
    source?: string;
    media?: string;
  }>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    visible: { cls: "bg-green/10 text-green", label: "可见" },
    hidden: { cls: "bg-amber/10 text-amber", label: "隐藏" },
    archived: { cls: "bg-panel-2 text-text-3", label: "归档" },
  };
  const s = map[status] ?? { cls: "bg-panel-2 text-text-3", label: status };
  return <span className={`rounded-sm px-1.5 py-px text-[10px] ${s.cls}`}>{s.label}</span>;
}

/** 媒体徽章(原型 media-tag:文字 i-filetext / 短视频 i-video) */
function MediaBadge({ mediaType }: { mediaType: string }) {
  const video = mediaType === "video";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-px text-[10px] ${
        video ? "bg-accent-dim text-accent" : "bg-panel-2 text-text-2"
      }`}
    >
      <svg className="ic ic-sm" aria-hidden="true">
        <use href={video ? "#i-video" : "#i-filetext"} />
      </svg>
      {video ? "短视频" : "文字"}
    </span>
  );
}

export default async function AdminTelegramPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const segment = parseListSegment(TELEGRAM_LIST_SEGMENTS, sp.status, "all");
  const page = parsePage(sp.page);
  const q = sp.q?.trim() || undefined;
  const sourceId = /^\d{1,10}$/.test(sp.source ?? "") ? Number(sp.source) : undefined;
  const media: FeedMediaFilter = FEED_MEDIA_FILTERS.includes(sp.media as FeedMediaFilter)
    ? (sp.media as FeedMediaFilter)
    : "all";

  const { items, total, counts, sources } = await listTelegramAdmin({
    page,
    segment,
    sourceId,
    q,
    media,
  });
  const words = await listBlocklist();
  const totalPages = Math.max(1, Math.ceil(total / TELEGRAM_PAGE_SIZE));
  const pgBtn =
    "rounded-sm border border-line bg-panel px-2.5 py-1 font-mono text-xs text-text-2 hover:border-line-hover hover:text-text-1";
  const href = (seg: TelegramListSegment, p: number): string => {
    const params = new URLSearchParams();
    if (seg !== "all") params.set("status", seg);
    if (q) params.set("q", q);
    if (sourceId !== undefined) params.set("source", String(sourceId));
    if (media !== "all") params.set("media", media);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/telegram/?${qs}` : "/admin/telegram/";
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">电报流治理</h2>
        <p className="mt-0.5 text-xs text-text-3">
          采集条目准入观测与人工干预:过滤命中以隐藏态落库,误杀在此恢复;归档退出前台时间轴。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-sm border border-line">
          {TELEGRAM_LIST_SEGMENTS.map((seg) => (
            <Link
              key={seg}
              href={href(seg, 1)}
              className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
                seg === segment
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              {SEG_LABELS[seg]} {counts[seg]}
            </Link>
          ))}
        </div>
        <form method="GET" action="/admin/telegram/" className="ml-auto flex items-center gap-2">
          {segment !== "all" && <input type="hidden" name="status" value={segment} />}
          <select
            name="media"
            defaultValue={media === "all" ? "" : media}
            aria-label="媒体类型筛选"
            className="rounded-sm border border-line bg-panel px-2 py-1.5 text-xs text-text-2 outline-none focus:border-accent"
          >
            <option value="">{MEDIA_LABELS.all}</option>
            <option value="text">{MEDIA_LABELS.text}</option>
            <option value="video">{MEDIA_LABELS.video}</option>
          </select>
          <select
            name="source"
            defaultValue={sp.source ?? ""}
            aria-label="来源渠道筛选"
            className="rounded-sm border border-line bg-panel px-2 py-1.5 text-xs text-text-2 outline-none focus:border-accent"
          >
            <option value="">全部来源</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 focus-within:border-accent">
            <svg className="ic ic-sm text-text-3" aria-hidden="true">
              <use href="#i-search" />
            </svg>
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="搜索标题 / 摘要…"
              className="w-52 bg-transparent text-[13px] outline-none placeholder:text-text-3"
            />
          </div>
        </form>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">条目</th>
              <th className="px-3 py-2.5 font-medium">媒体</th>
              <th className="px-3 py-2.5 font-medium">来源</th>
              <th className="px-3 py-2.5 font-medium">过滤命中</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 font-medium">时间</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => {
              const isVideo = t.mediaType === "video";
              const duration = isVideo ? formatDuration(t.videoDuration) : null;
              const like = isVideo ? compactCount(t.videoEngagement?.like) : null;
              const comment = isVideo ? compactCount(t.videoEngagement?.comment) : null;
              return (
                <tr key={t.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                  <td className="max-w-[380px] px-4 py-2.5">
                    {isVideo ? (
                      <div className="flex gap-3">
                        <a
                          href={t.url}
                          target="_blank"
                          rel="noopener nofollow"
                          aria-label={`打开原视频:${t.title ?? ""}`}
                          className="relative h-[74px] w-[56px] flex-none overflow-hidden rounded-sm bg-panel-2"
                        >
                          {t.videoCoverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- 平台图床外链,不走 next/image 优化域
                            <img
                              src={t.videoCoverUrl}
                              alt={t.title ?? "视频封面"}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-text-3">
                              ▶
                            </div>
                          )}
                          {duration && (
                            <span className="absolute bottom-0.5 right-0.5 rounded-xs bg-black/70 px-1 font-mono text-[10px] leading-4 text-white">
                              {duration}
                            </span>
                          )}
                        </a>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-text-1">
                            {t.title ?? "(无标题)"}
                          </div>
                          {t.summary && (
                            <div className="mt-0.5 truncate text-[11px] text-text-3">
                              {t.summary}
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-3">
                            {like && <span>赞 {like}</span>}
                            {comment && <span>评 {comment}</span>}
                            <span title="短视频解读(抽轨/ASR/LLM)随解读批(M9)立项交付">
                              解读未启用
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="truncate font-medium text-text-1">
                          {t.title ?? "(无标题)"}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-text-3">{t.summary}</div>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <MediaBadge mediaType={t.mediaType} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-text-2">
                    {isVideo && t.videoPlatform
                      ? `${platformLabel(t.videoPlatform)} · ${t.videoBlogger ?? "未知博主"}`
                      : t.sourceName}
                  </td>
                  <td className="px-3 py-2.5">
                    {t.filterHit ? (
                      <span
                        className="rounded-sm bg-amber/10 px-1.5 py-px font-mono text-[10px] text-amber"
                        title="命中过滤规则,以隐藏态入库"
                      >
                        {t.filterHit}
                      </span>
                    ) : (
                      <span className="text-xs text-text-3">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-text-3">
                    {formatCnDateTime(t.publishedAt ?? t.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <TelegramRowOps
                      id={t.id}
                      title={t.title}
                      summary={t.summary}
                      status={t.status}
                    />
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-text-3">
                  没有符合条件的条目
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <span className="mr-auto text-xs text-text-3">
            共 {total.toLocaleString("en-US")} 条 · 第 {page} / {totalPages} 页
          </span>
          {page > 1 && (
            <Link href={href(segment, page - 1)} className={pgBtn} aria-label="上一页">
              ‹
            </Link>
          )}
          {pageWindow(page, totalPages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="text-xs text-text-3">
                …
              </span>
            ) : p === page ? (
              <span
                key={p}
                className="rounded-sm border border-accent bg-accent-dim px-2.5 py-1 font-mono text-xs font-semibold text-accent"
                aria-current="page"
              >
                {p}
              </span>
            ) : (
              <Link key={p} href={href(segment, p)} className={pgBtn}>
                {p}
              </Link>
            ),
          )}
          {page < totalPages && (
            <Link href={href(segment, page + 1)} className={pgBtn} aria-label="下一页">
              ›
            </Link>
          )}
        </div>
      </div>

      <BlocklistManager
        words={words.map((w) => ({
          id: w.id,
          word: w.word,
          scope: w.scope,
          hitCount: w.hitCount,
          enabled: w.enabled,
        }))}
      />

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:屏蔽词与启发式只影响新条目准入;隐藏/归档为人工终审动作,恢复即回前台。 命中规则计入
        filter_hit 不回溯。API:PUT /api/telegram/[id] · GET/POST /api/blocklist · PUT/DELETE
        /api/blocklist/[id]。
      </p>
    </div>
  );
}
