/**
 * 队列实况单行(crawler/interpreter 双队列同构件,批C 从 page 抽出):
 * 标题行(图标/名称/描述/四计数)+ 状态堆叠条(active/waiting/剩余/failed)+ 图例插槽。
 */
export interface QueueCounts {
  active: number;
  waiting: number;
  delayed: number;
  completed: number;
  failed: number;
}

export default function QueueLane({
  icon,
  name,
  desc,
  counts,
  iconPulse = false,
  legend,
}: {
  icon: string;
  name: string;
  desc: React.ReactNode;
  counts: QueueCounts;
  /** interpreter 在跑时图标点亮(crawler 恒亮) */
  iconPulse?: boolean;
  legend: React.ReactNode;
}) {
  const waiting = counts.waiting + counts.delayed;
  const busyTotal = Math.max(1, waiting + counts.active + counts.failed);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-text-1">
        <svg
          className={`ic ${iconPulse && counts.active > 0 ? "text-accent" : "text-text-3"}`}
          aria-hidden="true"
        >
          <use href={`#${icon}`} />
        </svg>
        <span>{name}</span>
        <span className="text-[11px] font-normal text-text-3">{desc}</span>
        <span className="ml-auto font-mono text-[11px] font-normal text-text-3">
          active <b>{counts.active}</b> · waiting <b>{waiting}</b> · completed{" "}
          <b>{counts.completed}</b> · failed <b>{counts.failed}</b>
        </span>
      </div>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-[5px] bg-panel-2">
        <span
          className="block h-full bg-accent"
          style={{ width: `${(counts.active / busyTotal) * 100}%` }}
        />
        <span
          className="block h-full bg-accent/45"
          style={{ width: `${(waiting / busyTotal) * 100}%` }}
        />
        <span className="block h-full flex-1" />
        <span
          className="block h-full bg-red"
          style={{ width: `${(counts.failed / busyTotal) * 100}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-4 font-mono text-[11px] text-text-3">{legend}</div>
    </div>
  );
}
