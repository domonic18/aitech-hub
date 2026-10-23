"use client";

/**
 * 配图工坊·版本链条(F14 板 18:762 对齐):根→当前单链横排,v 序号 chips
 * (v1…vN,当前「vN · 当前」高亮不可点),历史版本点击跳转对应工坊页
 * (RSC 取数);tooltip 保留 #id + 时间 + 产生方式溯源。末尾「＋ 新版本」
 * chip = 发起编辑的引导入口(滚动定位并高亮 EditPanel,不预建版本)。
 */
import { useRouter } from "next/navigation";

import { formatCnDateTime } from "@/lib/datetime";

import { ORIGIN_BADGE_CLS, ORIGIN_LABEL } from "./labels";

const CHIP_CLS = ORIGIN_BADGE_CLS.original; // v 序号 chip 统一中性底(溯源信息在 tooltip)

export default function VersionStrip({
  chain,
  currentId,
  onNewVersion,
}: {
  chain: Array<{ id: number; origin: string; createdAt: string }>;
  currentId: number;
  onNewVersion: () => void;
}): React.ReactElement {
  const router = useRouter();
  return (
    <section className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-panel-1 px-3 py-2">
      <span className="text-[11px] font-medium text-text-2">版本链</span>
      {chain.map((v, i) => {
        const current = v.id === currentId;
        const label = `v${i + 1}`;
        return (
          <span key={v.id} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-[10px] text-text-3">→</span>}
            <button
              type="button"
              disabled={current}
              onClick={() => router.push(`/admin/illustration/${v.id}`)}
              title={`版本 #${v.id} · ${ORIGIN_LABEL[v.origin] ?? v.origin} · ${formatCnDateTime(new Date(v.createdAt))}`}
              className={`cursor-pointer rounded-sm px-1.5 py-0.5 text-[10px] ${CHIP_CLS} ${
                current ? "cursor-default font-medium ring-1 ring-accent" : "hover:opacity-80"
              }`}
            >
              {current ? `${label} · 当前` : label}
            </button>
          </span>
        );
      })}
      <button
        type="button"
        onClick={onNewVersion}
        title="选中图层并输入编辑指令,生成预览确认后落新版本"
        className="cursor-pointer rounded-sm border border-dashed border-line px-1.5 py-0.5 text-[10px] text-text-2 hover:border-accent hover:text-accent"
      >
        ＋ 新版本
      </button>
    </section>
  );
}
