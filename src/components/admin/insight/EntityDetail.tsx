/**
 * 实体详情(M59 批B):事件时间线 + 经 meta.entityKey 关联的厂商信号。
 * 口径:事件来自 entity_event;相关信号只覆盖厂商抽取链写入的 meta.entityKey,
 * 社区/热榜信号暂无实体挂接(在空态文案里说明,避免误判丢失)。
 */
import Link from "next/link";

import {
  ENTITIES_PATH,
  ENTITY_EVENT_TAKE,
  type EntityDetail as EntityDetailData,
} from "@/lib/insight/entities-admin";
import {
  ENTITY_TYPE_LABELS,
  EVENT_TYPE_LABELS,
  type EntityEventType,
} from "@/lib/insight/vendor/constants";
import { VENDOR_DEFS } from "@/lib/insight/vendor/registry";

import { PanelCard } from "./PanelCard";
import SignalRow from "./SignalRow";
import { formatTime } from "./shared";

const VENDOR_NAME = new Map(VENDOR_DEFS.map((d) => [d.key, d.vendorName]));

const badge = "rounded-sm px-1.5 py-0.5 font-mono text-[10.5px] whitespace-nowrap";

export default function EntityDetailView({
  detail,
}: {
  detail: EntityDetailData;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={ENTITIES_PATH} className="text-[11px] text-text-3 hover:text-accent">
          ← 实体列表
        </Link>
        <h2 className="font-mono text-base font-semibold text-text-1">{detail.entityKey}</h2>
        {detail.vendors.map((v) => (
          <span key={v} className={`${badge} bg-panel-2 text-text-2`}>
            {VENDOR_NAME.get(v) ?? v}
          </span>
        ))}
        {detail.entityTypes.map((t) => (
          <span key={t} className={`${badge} bg-panel-2 text-text-3`}>
            {ENTITY_TYPE_LABELS[t as keyof typeof ENTITY_TYPE_LABELS] ?? t}
          </span>
        ))}
        <span className={`${badge} bg-accent-dim text-accent`}>事件 {detail.eventCount}</span>
      </div>

      <PanelCard
        title="事件时间线"
        hint="官方发布经 LLM 抽取的结构化事件;标题外链原文,按事件发生时间倒序"
        extra={
          detail.eventCount > ENTITY_EVENT_TAKE ? (
            <span className="font-mono text-[11px] text-text-3">
              最近 {ENTITY_EVENT_TAKE} / {detail.eventCount} 条
            </span>
          ) : undefined
        }
      >
        {detail.events.length === 0 ? (
          <p className="px-3 py-8 text-center text-[12.5px] text-text-3">
            该实体暂无抽取事件(仅有关联信号)。
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {detail.events.map((e) => (
              <li
                key={e.dedupeKey}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2.5"
              >
                <span className="w-[92px] shrink-0 font-mono text-[11px] text-text-3">
                  {formatTime(e.occurredAt)}
                </span>
                <span className={`shrink-0 ${badge} bg-panel-2 text-text-2`}>
                  {VENDOR_NAME.get(e.vendor) ?? e.vendor}
                </span>
                <span className={`shrink-0 ${badge} bg-accent-dim text-accent`}>
                  {EVENT_TYPE_LABELS[e.eventType as EntityEventType] ?? e.eventType}
                </span>
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 text-[12.5px] font-medium hover:text-accent"
                >
                  {e.title}
                </a>
                {e.summary !== null && e.summary !== "" && (
                  <p className="w-full pl-[92px] text-[11.5px] leading-5 text-text-2">
                    {e.summary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelCard>

      <PanelCard
        title="相关信号"
        hint="厂商抽取链同时入池的原始信号(meta.entityKey 关联)· 社区/热榜信号暂无实体挂接"
        extra={
          <span className="font-mono text-[11px] text-text-3">近 {detail.signals.length} 条</span>
        }
      >
        {detail.signals.length === 0 ? (
          <p className="px-3 py-8 text-center text-[12.5px] text-text-3">
            暂无关联信号——该实体的事件抽取完成但原文未入信号池,或信号已越过展示窗。
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {detail.signals.map((sig) => (
              <SignalRow key={sig.id} sig={sig} />
            ))}
          </ul>
        )}
      </PanelCard>
    </div>
  );
}
