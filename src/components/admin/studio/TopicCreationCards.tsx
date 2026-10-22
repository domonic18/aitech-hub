/**
 * 创作卡网格(v2 列表重构,替代原表格):3 列创作项目卡——标题 + 状态/主意图
 * + 进度 chips(素材 n / 长文 ✓|未生成 / 贴图 n)+ 更新时间,整卡直通详情。
 * 服务端纯展示件;贴图计数来自 pinCountByTopic(content_pin 软引用聚合)。
 */
import Link from "next/link";

import { formatCnDateTime } from "@/lib/datetime";
import {
  TOPIC_OUTPUT_LABEL,
  TOPIC_STATUS_LABEL,
  type TopicOutputType,
  type TopicStatus,
} from "@/lib/topics/constants";
import type { TopicWithCount } from "@/lib/topics/repo";

const STATUS_TONES: Record<TopicStatus, string> = {
  collecting: "bg-amber/12 text-amber-hi",
  drafted: "bg-panel-2 text-text-2",
  published: "bg-green/12 text-green",
};

function ProgressChip({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "muted" | "ok" | "accent";
}) {
  const tones = {
    muted: "text-text-3",
    ok: "text-green",
    accent: "text-accent",
  } as const;
  return (
    <span className={`rounded-sm bg-panel-2 px-1.5 py-0.5 text-[11px] ${tones[tone]}`}>
      {label} {value}
    </span>
  );
}

export default function TopicCreationCards({
  topics,
  pinCounts,
}: {
  topics: TopicWithCount[];
  pinCounts: Map<bigint, number>;
}) {
  if (topics.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-line px-3 py-10 text-center text-[12px] text-text-3">
        暂无创作——右上角「新建创作」开始,素材在视频解读完成或电报入库后挂载
      </p>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {topics.map((t) => {
        const status = t.status as TopicStatus;
        const intent = t.outputType as TopicOutputType;
        return (
          <Link
            key={t.id.toString()}
            href={`/admin/studio/${t.id.toString()}`}
            className="flex flex-col gap-2 rounded-sm border border-line bg-panel p-3 transition-colors hover:border-accent"
          >
            <div className="line-clamp-2 min-h-[2.5em] text-[13px] font-medium leading-snug text-text-1">
              {t.title}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${STATUS_TONES[status]}`}
              >
                {TOPIC_STATUS_LABEL[status] ?? t.status}
              </span>
              <span className="rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-2">
                {TOPIC_OUTPUT_LABEL[intent] ?? t.outputType}
              </span>
              <span className="ml-auto text-[11px] text-text-3">
                {formatCnDateTime(t.updatedAt)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
              <ProgressChip label="素材" value={String(t._count.items)} />
              {t.linkedPostId ? (
                <ProgressChip label="长文" value="✓" tone="ok" />
              ) : (
                <ProgressChip label="长文" value="未生成" />
              )}
              <ProgressChip
                label="贴图"
                value={String(pinCounts.get(t.id) ?? 0)}
                tone={(pinCounts.get(t.id) ?? 0) > 0 ? "accent" : "muted"}
              />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
