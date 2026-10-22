/**
 * 贴图状态 UI 投影(M41):徽标色档与短标签(卡角/步条用「已同步」短态,
 * 语义全称在 constants.PIN_STATUS_LABEL)。色档对齐 admin 既有 tone 口径
 * (amber=草稿/blue=进行中/accent=已同步/green=已发布,同 topics STATUS_TONES)。
 */
import type { PinStatus } from "@/lib/pins/constants";

export const PIN_BADGE_CLS: Record<PinStatus, string> = {
  draft: "bg-amber/80 text-white",
  pending: "bg-blue/80 text-white",
  synced: "bg-accent text-white",
  published: "bg-green text-white",
};

export const PIN_BADGE_LABEL: Record<PinStatus, string> = {
  draft: "草稿",
  pending: "待验收",
  synced: "已同步",
  published: "已发布",
};
