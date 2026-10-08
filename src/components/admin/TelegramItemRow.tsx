/**
 * 电报流治理表行(批C 从 page 抽出):视频行 = 封面缩略(时长角标)+ 标题摘要 +
 * 互动/解读态注记;文字行 = 标题摘要。徽章与行内操作复用既有件,纯展示。
 * 2026-10-05 反馈:标题下灰字改显 AI 解读(aiSummary;未解读/无解读回退原始
 * summary,解读态由 AiBadge 表达),与用户「这行应是解读内容」的预期一致。
 */
import TelegramRowOps from "@/components/admin/TelegramRowOps";
import { AiBadge, MediaBadge, StatusBadge } from "@/components/admin/TelegramBadges";
import { formatCnDateTime } from "@/lib/datetime";
import { compactCount, formatDuration, platformLabel } from "@/lib/telegram/feed-view";
import type { TelegramAdminList } from "@/lib/telegram/telegram-admin";

type Item = TelegramAdminList["items"][number];

export default function TelegramItemRow({ item: t }: { item: Item }) {
  const isVideo = t.mediaType === "video";
  const duration = isVideo ? formatDuration(t.videoDuration) : null;
  const like = isVideo ? compactCount(t.videoEngagement?.like) : null;
  const comment = isVideo ? compactCount(t.videoEngagement?.comment) : null;
  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-panel-2">
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
              <div className="truncate font-medium text-text-1">{t.title ?? "(无标题)"}</div>
              {(t.aiSummary || t.summary) && (
                <div
                  className="mt-0.5 truncate text-[11px] text-text-3"
                  title={t.aiSummary || t.summary}
                >
                  {t.aiSummary || t.summary}
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-3">
                {like && <span>赞 {like}</span>}
                {comment && <span>评 {comment}</span>}
                <AiBadge aiStatus={t.aiStatus} lastAiError={t.lastAiError} />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="truncate font-medium text-text-1">{t.title ?? "(无标题)"}</div>
            <div
              className="mt-0.5 truncate text-[11px] text-text-3"
              title={t.aiSummary || t.summary}
            >
              {t.aiSummary || t.summary}
            </div>
            {/* 批⑥:文字行也显解读态(摘要按钮的完成/失败可见,与视频行同口径) */}
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-3">
              <AiBadge aiStatus={t.aiStatus} lastAiError={t.lastAiError} />
            </div>
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
          mediaType={t.mediaType}
          aiStatus={t.aiStatus}
        />
      </td>
    </tr>
  );
}
