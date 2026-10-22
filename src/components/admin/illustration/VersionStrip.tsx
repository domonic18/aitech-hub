"use client";

/**
 * 配图工坊·版本链条(M40 批 B):根→当前单链横排(origin 徽标 + 时间),
 * 当前高亮不可点,历史版本点击跳转对应工坊页(RSC 取数)。
 */
import { useRouter } from "next/navigation";

import { formatCnDateTime } from "@/lib/datetime";

import { ORIGIN_BADGE_CLS, ORIGIN_LABEL } from "./labels";

export default function VersionStrip({
  chain,
  currentId,
}: {
  chain: Array<{ id: number; origin: string; createdAt: string }>;
  currentId: number;
}): React.ReactElement {
  const router = useRouter();
  return (
    <section className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-panel-1 px-3 py-2">
      <span className="text-[11px] font-medium text-text-2">版本链</span>
      {chain.map((v, i) => {
        const current = v.id === currentId;
        const cls = ORIGIN_BADGE_CLS[v.origin] ?? ORIGIN_LABEL.original;
        return (
          <span key={v.id} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-[10px] text-text-3">→</span>}
            <button
              type="button"
              disabled={current}
              onClick={() => router.push(`/admin/illustration/${v.id}`)}
              title={`版本 #${v.id} · ${formatCnDateTime(new Date(v.createdAt))}`}
              className={`cursor-pointer rounded-sm px-1.5 py-0.5 text-[10px] disabled:cursor-default disabled:ring-1 disabled:ring-accent ${
                current ? "font-medium" : "hover:opacity-80"
              } ${cls}`}
            >
              {ORIGIN_LABEL[v.origin] ?? v.origin} #{v.id}
            </button>
          </span>
        );
      })}
    </section>
  );
}
