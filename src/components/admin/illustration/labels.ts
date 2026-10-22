/**
 * 配图工坊·展示字典(M40 批 B):版本产生方式与编辑回路的中文标签/徽标配色,
 * VersionStrip 与 StudioPage 头部共用(防两处漂移)。
 */

export const ORIGIN_LABEL: Record<string, string> = {
  original: "原图",
  text_edit: "改字",
  erase: "消除",
  redraw: "重绘",
};

export const ORIGIN_BADGE_CLS: Record<string, string> = {
  original: "bg-panel-2 text-text-3",
  text_edit: "bg-accent/10 text-accent",
  erase: "bg-amber/10 text-amber",
  redraw: "bg-green/10 text-green",
};

export const EDIT_MODES = [
  { key: "text", label: "改字", tip: "框选文字区域,填入新文案(逐字准确)" },
  { key: "erase", label: "消除", tip: "框选要消除的元素,可留补充说明" },
  { key: "redraw", label: "重绘", tip: "框选区域,描述要重绘成什么样" },
] as const;

export type EditMode = (typeof EDIT_MODES)[number]["key"];

/** 编辑回路 mode → 版本 origin(与后端 ILLUSTRATION_VERSION_ORIGINS 对齐) */
export const MODE_TO_ORIGIN: Record<EditMode, "text_edit" | "erase" | "redraw"> = {
  text: "text_edit",
  erase: "erase",
  redraw: "redraw",
};

export type NormalizedBbox = [number, number, number, number];
