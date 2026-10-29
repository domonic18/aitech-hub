"use client";

/**
 * 价格策展控制台壳(M56 策展台重构):模型牌价 | Coding Plan 双页签——
 * 替代此前三板长页平铺(2026-10-29 验收反馈:信息无主次)。
 * 渠道维护已统一并入 数据中心·源管理·采集渠道(2026-10-29 反馈,
 * crawl_source type=pricing),本页不再含渠道页签。
 * 数据由服务端页传入,本壳只做页签切换。
 */
import { useState } from "react";

import type { CodingPlanRow, ModelPricingRow } from "@/lib/pricing/admin";

import ModelsBoard from "./ModelsBoard";
import PlansBoard from "./PlansBoard";

const TABS = ["模型牌价", "Coding Plan"] as const;
type Tab = (typeof TABS)[number];

export default function PricingConsole({
  models,
  plans,
}: {
  models: ModelPricingRow[];
  plans: CodingPlanRow[];
}): React.ReactElement {
  const [tab, setTab] = useState<Tab>("模型牌价");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex rounded-sm border border-line bg-panel-2 p-0.5">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-sm px-3 py-1.5 text-xs ${
              tab === t ? "bg-panel font-medium text-text-1" : "text-text-3 hover:text-text-2"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "模型牌价" && <ModelsBoard rows={models} />}
      {tab === "Coding Plan" && <PlansBoard rows={plans} />}
    </div>
  );
}
