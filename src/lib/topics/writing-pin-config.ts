/**
 * 贴图创作配置(M42 创作中心)——「贴一套什么样的图」的结构化选择 ↔ 条款文本
 * 往返,与长文 writing-config 同款机制、独立列(topic.pin_positioning):
 * - 载体两段式:画面条款行(张数/比例/首图裁剪,恒出)+ 风格条款行(有值才出)
 *   + 参照图条款行(人工指定时出,站内 uploads 路径)+【补充要求】自由块
 *   (verbatim 透传 AI);复用 writing-config 的分界头。
 * - 选项卡只由点击驱动;解析时未识别行一律收进补充块(保存永不销毁内容)。
 * - 比例键与 illustrate 生图档位同域(PIN_ASPECTS = ILLUSTRATE_ASPECT_SIZES
 *   的键);裁剪键复用公众号 newspic 三档(PIN_CROP_SPECS),首图即封面。
 */
import { isUploadsPath } from "../media/refs";
import { PIN_CROP_SPECS, PIN_IMAGES_MAX, type PinCropSpec } from "../pins/constants";
import { SUPPLEMENT_HEADER } from "./writing-config";

/** 生图宽高比(键与 src/lib/ai/illustrate-generate.ts 的档位表同域) */
export const PIN_ASPECTS = ["3:4", "1:1", "16:9"] as const;
export type PinAspectKey = (typeof PIN_ASPECTS)[number];

export const PIN_COUNT_MIN = 1;
export const PIN_COUNT_MAX = PIN_IMAGES_MAX;

export interface PinWritingSelection {
  /** 图片张数(1..20;公众号 newspic image_list 硬上限) */
  count: number;
  /** 生图宽高比(小绿书竖版 3:4 缺省) */
  aspect: PinAspectKey;
  /** 首图(封面)裁剪档 */
  crop: PinCropSpec;
  /** 画面风格自由文本(空 = 交给参照图与技能指南承载,不写配色/风格词) */
  style: string;
  /** 人工指定的参照图(站内 uploads 路径;空 = 由 agent 按样例图→视频封面→文章配图→本创作贴图的优先级自选) */
  reference: string;
}

export const DEFAULT_PIN_WRITING_SELECTION: PinWritingSelection = {
  count: 6,
  aspect: "3:4",
  crop: "1_1",
  style: "",
  reference: "",
};

/** 条款行(精确字符串 = 反向解析锚点;改文案必须连测试一起改) */
const FRAME_RE = /^画面:共 (\d{1,2}) 张,比例 (16:9|3:4|1:1),首图裁剪 (1_1|16_9|2\.35_9)。$/;
const STYLE_PREFIX = "风格:";
const REFERENCE_PREFIX = "参照图:";

/** 张数收敛到合法域(越界/非数回落缺省;调用侧与解析侧共用) */
export function clampPinCount(n: number | undefined): number {
  const v = Math.trunc(n ?? NaN);
  if (!Number.isFinite(v)) return DEFAULT_PIN_WRITING_SELECTION.count;
  return Math.min(PIN_COUNT_MAX, Math.max(PIN_COUNT_MIN, v));
}

export function composePinWritingText(
  sel: PinWritingSelection,
  supplement?: string | null,
): string {
  const lines = [
    `画面:共 ${clampPinCount(sel.count)} 张,比例 ${sel.aspect},首图裁剪 ${sel.crop}。`,
  ];
  const style = sel.style.trim();
  if (style) lines.push(`${STYLE_PREFIX}${style}`);
  // 参照图仅收站内 uploads(与非本站路径混用会破坏生成期校验,宁可不写)
  const reference = sel.reference.trim();
  if (reference && isUploadsPath(reference)) lines.push(`${REFERENCE_PREFIX}${reference}`);
  const supp = (supplement ?? "").trim();
  return supp ? `${lines.join("\n")}\n${SUPPLEMENT_HEADER}\n${supp}` : lines.join("\n");
}

export interface PinWritingParse {
  selection: PinWritingSelection;
  supplement: string;
  /** 条款被手改/张数越界/未知契约行 = true(提示用户核对,内容已无损收进补充) */
  custom: boolean;
}

export function parsePinWritingText(text: string | null): PinWritingParse {
  const lines = (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const headerIdx = lines.indexOf(SUPPLEMENT_HEADER);
  const headLines = headerIdx >= 0 ? lines.slice(0, headerIdx) : lines;
  const suppLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : [];
  const sel: PinWritingSelection = { ...DEFAULT_PIN_WRITING_SELECTION };
  const rest: string[] = [];
  let custom = false;
  let frameSeen = false;
  let styleSeen = false;
  let referenceSeen = false;
  for (const line of headLines) {
    const frame = FRAME_RE.exec(line);
    if (frame) {
      if (frameSeen) custom = true; // 同维冲突条款(防御:不该出现)
      frameSeen = true;
      const n = Number(frame[1]);
      if (n < PIN_COUNT_MIN || n > PIN_COUNT_MAX) custom = true;
      sel.count = clampPinCount(n);
      sel.aspect = frame[2] as PinAspectKey;
      sel.crop = frame[3] as PinCropSpec;
      continue;
    }
    if (line.startsWith(STYLE_PREFIX)) {
      if (styleSeen) custom = true;
      styleSeen = true;
      sel.style = line.slice(STYLE_PREFIX.length).trim();
      continue;
    }
    if (line.startsWith(REFERENCE_PREFIX)) {
      if (referenceSeen) custom = true;
      referenceSeen = true;
      const path = line.slice(REFERENCE_PREFIX.length).trim();
      // 非站内路径不采纳(手改坏值收进补充块,内容仍不丢)
      if (isUploadsPath(path)) {
        sel.reference = path;
        continue;
      }
      custom = true;
    }
    if (line.startsWith("画面:")) custom = true; // 契约行被手改
    rest.push(line);
  }
  return {
    selection: sel,
    supplement: [...rest, ...suppLines].join("\n"),
    custom,
  };
}

/** 配置文本是否显式指定了画面风格(agent 侧「有风格即不写配色词」判定同源) */
export function pinStyleOf(pinPositioning: string | null): string {
  return parsePinWritingText(pinPositioning).selection.style;
}

/** 人工指定的参照图(空串 = 未指定,agent 按 candidates 优先级自选) */
export function pinReferenceOf(pinPositioning: string | null): string {
  return parsePinWritingText(pinPositioning).selection.reference;
}

/** 裁剪档展示名(组装台/创作台同源;值仍是公众号契约字面量) */
export const PIN_CROP_LABEL: Record<PinCropSpec, string> = {
  "1_1": "方图 1:1",
  "16_9": "横图 16:9",
  "2.35_9": "超宽 2.35:9",
};

/** 比例展示名(UI 选项用) */
export const PIN_ASPECT_LABEL: Record<PinAspectKey, string> = {
  "3:4": "竖版 3:4(小绿书缺省)",
  "1:1": "方版 1:1",
  "16:9": "横版 16:9",
};

/** 合法性自检锚点(单测/边界共用):裁剪值必须落在 newspic 三档 */
export function isPinCropSpec(v: string): v is PinCropSpec {
  return (PIN_CROP_SPECS as readonly string[]).includes(v);
}
