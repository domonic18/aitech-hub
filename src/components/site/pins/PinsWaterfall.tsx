/**
 * 贴图瀑布流(site,M41):CSS columns 图片驱动轻浏览(原型 site-pins 同款,
 * 区别于文章列表的信息密度阅读)。卡=封面(自然比例,缺尺寸降 3:4)+ 标题 +
 * 轻文字摘要 + n 图/日期 meta;链接一律经 pinPath 构造(URL 红线)。
 */
import Image from "next/image";
import Link from "next/link";

import { asciiSlugFromTitle, pinPath } from "@/lib/content/pin-path";
import { formatCnDate } from "@/lib/datetime";

export interface PinWaterfallItem {
  id: bigint;
  title: string;
  content: string;
  publishedAt: Date | null;
  coverPath: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
  imageCount: number;
}

export default function PinsWaterfall({
  items,
  emptyHint,
}: {
  items: PinWaterfallItem[];
  emptyHint: string;
}): React.ReactElement {
  if (items.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[var(--site-max-w)] px-4 pb-16 sm:px-6">
        <div className="rounded-md border border-dashed border-line px-4 py-16 text-center text-sm text-text-3">
          {emptyHint}
        </div>
      </div>
    );
  }
  return (
    <div
      className="mx-auto w-full max-w-[var(--site-max-w)] px-4 pb-14 sm:px-6"
      style={{ columns: "4 240px", columnGap: 16 }}
    >
      {items.map((p) => {
        const hasDims = p.coverWidth != null && p.coverHeight != null && p.coverHeight > 0;
        return (
          <Link
            key={p.id}
            href={pinPath(p.id, asciiSlugFromTitle(p.title))}
            className="mb-4 block break-inside-avoid overflow-hidden rounded-md border border-line bg-panel transition-transform hover:-translate-y-0.5 hover:border-[var(--border-hover)]"
          >
            <div
              className={`relative bg-panel-2 ${hasDims ? "" : "aspect-[3/4]"}`}
              style={hasDims ? { aspectRatio: `${p.coverWidth} / ${p.coverHeight}` } : undefined}
            >
              {p.coverPath && (
                <Image
                  src={p.coverPath}
                  alt={p.title}
                  fill
                  unoptimized
                  loading="lazy"
                  className="object-cover"
                  sizes="(max-width: 640px) 50vw, 240px"
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5 px-3.5 pb-3.5 pt-3">
              <h3 className="text-[15px] font-semibold leading-snug text-text-1">{p.title}</h3>
              {p.content && (
                <p className="line-clamp-3 text-[12.5px] leading-relaxed text-text-2">
                  {p.content}
                </p>
              )}
              <div className="mt-0.5 flex items-center gap-2 font-mono text-[11.5px] text-text-3">
                <span>{p.imageCount} 图</span>
                {p.publishedAt && <span>{formatCnDate(p.publishedAt)}</span>}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
