/**
 * 配图工坊·展示字典(M40 批 B 建,F13/F14 对齐批贴板):版本产生方式、
 * 编辑回路与登记来源的中文标签/徽标配色,VersionStrip 与 StudioPage
 * 头部共用(防两处漂移)。三模式文案贴 F14 板(18:813):文字修改|消除笔|自由重绘。
 */

export const ORIGIN_LABEL: Record<string, string> = {
  original: "原图",
  text_edit: "文字修改",
  erase: "消除笔",
  redraw: "自由重绘",
};

export const ORIGIN_BADGE_CLS: Record<string, string> = {
  original: "bg-panel-2 text-text-3",
  text_edit: "bg-accent/10 text-accent",
  erase: "bg-amber/10 text-amber",
  redraw: "bg-green/10 text-green",
};

/** 登记来源(F14 头部 chip;null=历史行不显,与 ILLUSTRATION_SOURCES 对齐) */
export const SOURCE_LABEL: Record<string, string> = {
  agent: "来源:agent 会话",
  studio: "来源:工坊直出",
};

export const EDIT_MODES = [
  { key: "text", label: "文字修改", tip: "框选文字区域,填入新文案(逐字准确)" },
  { key: "erase", label: "消除笔", tip: "框选要消除的元素,可留补充说明" },
  { key: "redraw", label: "自由重绘", tip: "框选区域,描述要重绘成什么样" },
] as const;

export type EditMode = (typeof EDIT_MODES)[number]["key"];

/** 编辑回路 mode → 版本 origin(与后端 ILLUSTRATION_VERSION_ORIGINS 对齐) */
export const MODE_TO_ORIGIN: Record<EditMode, "text_edit" | "erase" | "redraw"> = {
  text: "text_edit",
  erase: "erase",
  redraw: "redraw",
};

export type NormalizedBbox = [number, number, number, number];
