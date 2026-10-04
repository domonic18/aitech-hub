/**
 * 进展动态时间轴(M11 批④):commits + releases 归并展示——同步管道已按
 * occurredAt 倒序归并(arch/05-services §4.2),组件只做纯渲染;外链
 * nofollow,title 链到 commit/release 原址。空数据返回 null(节由页面侧收敛)。
 */
import { formatCnDate } from "@/lib/datetime";
import type { RepoActivityItem } from "@/lib/github/public";

export default function RepoTimeline({
  items,
}: {
  items: RepoActivityItem[];
}): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="border-b border-line/60 pb-2 text-base font-semibold text-text-1">进展动态</h2>
      <ol className="mt-4 space-y-3">
        {items.map((it) => {
          const isRelease = it.kind === "release";
          return (
            <li
              key={it.id.toString()}
              className="flex items-baseline gap-2.5 text-[13px] leading-relaxed"
            >
              <svg
                className={`ic ic-sm flex-none translate-y-0.5 ${isRelease ? "text-amber" : "text-accent"}`}
                aria-hidden="true"
              >
                <use href={isRelease ? "#i-fire" : "#i-code"} />
              </svg>
              <span className="min-w-0 flex-1">
                {it.url ? (
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-text-1 hover:text-accent-hover"
                  >
                    {it.title}
                  </a>
                ) : (
                  <span className="text-text-1">{it.title}</span>
                )}
                {it.author && <span className="ml-2 text-[11.5px] text-text-3">@{it.author}</span>}
              </span>
              <span
                className={`flex-none rounded border px-1.5 py-px font-mono text-[10.5px] ${
                  isRelease
                    ? "border-amber/30 bg-amber/10 text-amber"
                    : "border-line bg-panel-2 text-text-3"
                }`}
              >
                {it.kind}
              </span>
              <time
                dateTime={it.occurredAt.toISOString()}
                className="flex-none font-mono text-[11.5px] text-text-3"
              >
                {formatCnDate(it.occurredAt)}
              </time>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
