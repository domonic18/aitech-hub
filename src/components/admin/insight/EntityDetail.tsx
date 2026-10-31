/**
 * 实体详情(M59 批B → M60 实体层):事件时间线 + 经 meta.entityKey 关联的厂商
 * 信号,外加实体层次(品牌 › 产品线)、别名组与同族实体——归并入口在此。
 * 口径:事件来自 entity_event(按 entity_id);相关信号覆盖本实体全部别名写入的
 * meta.entityKey,社区/热榜信号暂无实体挂接(在空态文案里说明,避免误判丢失)。
 */
import Link from "next/link";

import {
  ENTITIES_PATH,
  ENTITY_EVENT_TAKE,
  entityHref,
  type EntityDetail as EntityDetailData,
  type EntityLink,
} from "@/lib/insight/entities-admin";
import {
  ENTITY_TYPE_LABELS,
  EVENT_TYPE_LABELS,
  type EntityEventType,
} from "@/lib/insight/vendor/constants";
import { VENDOR_DEFS } from "@/lib/insight/vendor/registry";

import MergeEntityControl from "./MergeEntityControl";
import { PanelCard } from "./PanelCard";
import SignalRow from "./SignalRow";
import { formatTime } from "./shared";

const VENDOR_NAME = new Map(VENDOR_DEFS.map((d) => [d.key, d.vendorName]));

const badge = "rounded-sm px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap";

/** 同族实体 chip:展示名 + 事件数,点进详情 */
function RelatedChip({ link }: { link: EntityLink }): React.ReactElement {
  return (
    <Link
      href={entityHref(link.key)}
      className="inline-flex items-center gap-1 rounded-sm border border-line bg-panel px-1.5 py-0.5 text-[11px] text-text-2 hover:border-line-hover hover:text-accent"
      title={link.key}
    >
      <span className="max-w-[180px] truncate">{link.displayName}</span>
      {link.eventCount !== undefined && (
        <span className="font-mono text-[10px] text-text-3">{link.eventCount}</span>
      )}
    </Link>
  );
}

export default function EntityDetailView({
  detail,
}: {
  detail: EntityDetailData;
}): React.ReactElement {
  const parentIsRoot = detail.parent === null || detail.parent.key === detail.root?.key;
  const aliases = detail.aliases.filter((k) => k !== detail.key);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={ENTITIES_PATH} className="text-[11px] text-text-3 hover:text-accent">
          ← 实体列表
        </Link>
        <h2 className="text-base font-semibold text-text-1">{detail.displayName}</h2>
        <span className="font-mono text-[11px] text-text-3">{detail.key}</span>
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
        <span className="ml-auto">
          <MergeEntityControl fromKey={detail.key} />
        </span>
      </div>

      {(detail.root !== null || aliases.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-3">
          {detail.root !== null && (
            <span className="flex items-center gap-1">
              <span>所属</span>
              <Link href={entityHref(detail.root.key)} className="text-text-2 hover:text-accent">
                {detail.root.displayName}
              </Link>
              {detail.parent !== null && !parentIsRoot && (
                <>
                  <span>›</span>
                  <Link
                    href={entityHref(detail.parent.key)}
                    className="text-text-2 hover:text-accent"
                  >
                    {detail.parent.displayName}
                  </Link>
                </>
              )}
            </span>
          )}
          {aliases.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              <span>别名 {aliases.length}</span>
              {aliases.map((k) => (
                <span key={k} className={`${badge} bg-panel-2 text-text-3`}>
                  {k}
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      {(detail.children.length > 0 || detail.siblings.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {detail.children.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-text-3">下级</span>
              {detail.children.map((c) => (
                <RelatedChip key={c.key} link={c} />
              ))}
            </span>
          )}
          {detail.siblings.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-text-3">同族</span>
              {detail.siblings.map((c) => (
                <RelatedChip key={c.key} link={c} />
              ))}
            </span>
          )}
        </div>
      )}

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
          <p className="px-3 py-8 text-center text-[13px] text-text-3">
            {detail.children.length > 0
              ? "该实体本体暂无抽取事件——事件挂在子实体上,点上方「下级」查看。"
              : "该实体暂无抽取事件(仅有关联信号)。"}
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
                  className="min-w-0 flex-1 text-[13px] font-medium hover:text-accent"
                >
                  {e.title}
                </a>
                {e.summary !== null && e.summary !== "" && (
                  <p className="w-full pl-[92px] text-[12px] leading-5 text-text-2">{e.summary}</p>
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
          <p className="px-3 py-8 text-center text-[13px] text-text-3">
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
