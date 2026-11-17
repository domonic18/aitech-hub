/**
 * 电报流治理表行(批C 从 page 抽出;2026-11-17 站长反馈排版重构):
 * **全行统一左侧媒体轨道**(56px 封面位 + 16px 间距)——视频行放封面(时长
 * 角标),文字行留空轨道;标题/摘要左缘全表对齐,行高一致,封面与文字
 * 恒有间距。标题下灰字显 AI 解读(aiSummary;未解读/无解读回退原始
 * summary,解读态由 AiBadge 表达)。
 */
import TelegramRowOps from "@/components/admin/telegram/TelegramRowOps";
import { RowCheckbox } from "@/components/admin/batch/SelectionCheckbox";
import { AiBadge, MediaBadge, StatusBadge } from "@/components/admin/telegram/TelegramBadges";
import { formatCnDateTime } from "@/lib/datetime";
import { compactCount, formatDuration, platformLabel } from "@/lib/telegram/feed-view";
import type { TelegramAdminList } from "@/lib/telegram/telegram-admin";

type Item = TelegramAdminList["items"][number];

/** 左侧媒体轨道:视频行 = 封面缩略(时长角标);文字行 = 等尺寸空位(对齐用) */
function MediaRail({
  isVideo,
  coverUrl,
  title,
  url,
  duration,
}: {
  isVideo: boolean;
  coverUrl: string | null;
  title: string | null;
  url: string;
  duration: string | null;
}): React.ReactElement | null {
  if (!isVideo) return <div aria-hidden className="h-[74px] w-[56px] flex-none" />;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener nofollow"
      aria-label={`打开原视频:${title ?? ""}`}
      className="relative h-[74px] w-[56px] flex-none overflow-hidden rounded-sm bg-panel-2"
    >
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 平台图床外链,不走 next/image 优化域
        <img
          src={coverUrl}
          alt={title ?? "视频封面"}
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
  );
}

export default function TelegramItemRow({
  item: t,
  checkbox,
}: {
  item: Item;
  /** 多选勾选格(M31 验收反馈):批量条在场时由 TelegramTable 传入,渲染为行首格 */
  checkbox?: { checked: boolean; onToggle: () => void };
}) {
  const isVideo = t.mediaType === "video";
  const duration = isVideo ? formatDuration(t.videoDuration) : null;
  const like = isVideo ? compactCount(t.videoEngagement?.like) : null;
  const comment = isVideo ? compactCount(t.videoEngagement?.comment) : null;
  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-panel-2">
      {checkbox && (
        <td className="w-10 px-3 py-2.5 align-middle">
          <RowCheckbox
            label={`选择 ${t.title ?? t.id}`}
            checked={checkbox.checked}
            onToggle={checkbox.onToggle}
          />
        </td>
      )}
      <td className="max-w-[380px] px-4 py-2.5">
        <div className="flex gap-4">
          <MediaRail
            isVideo={isVideo}
            coverUrl={t.videoCoverUrl}
            title={t.title}
            url={t.url}
            duration={duration}
          />
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
            {/* 批⑥:文字行也显解读态(摘要按钮的完成/失败可见,与视频行同口径) */}
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-3">
              {like && <span>赞 {like}</span>}
              {comment && <span>评 {comment}</span>}
              <AiBadge aiStatus={t.aiStatus} lastAiError={t.lastAiError} />
            </div>
          </div>
        </div>
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
