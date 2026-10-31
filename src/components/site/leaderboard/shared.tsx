/**
 * 榜单展示原子件(M63):名次变动、实体外链、小号 chip、空态。
 * 原 LeaderboardView 内的内联件集中至此,三个榜形态共用一套视觉口径。
 */
import type { PublicLeaderboardRow } from "@/lib/leaderboard/public";

/** 名次变动:正=上升、负=下降、0=持平;null 且无上期 → 「–」,有上期 → NEW */
export function DeltaMark({
  delta,
  hasPrevious = true,
}: {
  delta: number | null;
  hasPrevious?: boolean;
}): React.ReactElement {
  if (!hasPrevious) return <span className="font-mono text-[11px] text-text-3">–</span>;
  if (delta === null) return <span className="font-mono text-[11px] text-accent">NEW</span>;
  if (delta > 0) return <span className="font-mono text-[11px] text-green">▲{delta}</span>;
  if (delta < 0) return <span className="font-mono text-[11px] text-red">▼{-delta}</span>;
  return <span className="font-mono text-[11px] text-text-3">–</span>;
}

/** 实体名(无外链则纯文本,不渲染死链) */
export function EntityLink({
  row,
  className = "text-[13px] text-text-1 hover:text-accent-hover",
}: {
  row: PublicLeaderboardRow;
  className?: string;
}): React.ReactElement {
  const label = row.entityName === "" ? row.entityKey : row.entityName;
  if (row.url === "") return <span className="text-[13px] text-text-1">{label}</span>;
  return (
    <a href={row.url} target="_blank" rel="nofollow noopener noreferrer" className={className}>
      {label}
    </a>
  );
}

const CHIP_TONES = {
  default: "bg-panel-2 text-text-3",
  accent: "bg-accent-dim text-accent",
  amber: "bg-amber/10 text-amber",
  green: "bg-green/10 text-green",
} as const;

export function Chip({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: keyof typeof CHIP_TONES;
}): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[11px] ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyBoard({ text }: { text: string }): React.ReactElement {
  return (
    <p className="mt-3 rounded-lg border border-dashed border-line bg-panel px-4 py-10 text-center text-[13px] text-text-3">
      {text}
    </p>
  );
}
