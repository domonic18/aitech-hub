/**
 * 词云螺旋排布纯函数(M34 批③ 验收反馈·问题3 行业词云形态):阿基米德螺旋
 * 紧密排布,矩形碰撞检测保证无重叠,权重决定字号与颜色档。零 DOM 依赖,
 * KeywordCloud 视图消费(客户端 canvas 量测注入),packWords 为测试锚点。
 */
import type { InsightCloudWord } from "./hotboard";

export const CLOUD_H = 300;
export const FONT_MIN = 14;
export const FONT_MAX = 42;
export const GAP = 2;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedWord {
  word: InsightCloudWord;
  x: number;
  y: number;
  px: number;
  vertical: boolean;
  /** 0-1 权重档(着色/字重) */
  t: number;
}

function overlaps(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + GAP && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + GAP;
}

/** 权重档着色(令牌变量,双主题自适应;高分层更亮) */
export function tierColor(t: number): string {
  if (t >= 0.75) return "var(--accent-hi)";
  if (t >= 0.55) return "var(--blue)";
  if (t >= 0.35) return "var(--green-hi)";
  if (t >= 0.18) return "var(--amber-hi)";
  return "var(--text-2)";
}

/**
 * 螺旋排布纯函数:words 按权重降序输入,自中心向外第一条不重叠位放置;
 * 竖排词按 1/4 比例(≥8 词才启用);超宽词缩字号;放不下截断。
 */
export function packWords(
  words: InsightCloudWord[],
  width: number,
  height: number,
  measure: (text: string, px: number) => { w: number; h: number },
): PlacedWord[] {
  if (words.length === 0) return [];
  const weights = words.map((w) => w.weight);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const span = Math.max(max - min, 1);
  const boxes: Box[] = [];
  const out: PlacedWord[] = [];
  words.forEach((word, i) => {
    const t = (word.weight - min) / span;
    let px = FONT_MIN + t * (FONT_MAX - FONT_MIN);
    const vertical = words.length >= 8 && i % 4 === 2;
    let { w, h } = measure(word.word, px);
    if (vertical) [w, h] = [h, w];
    if (w > width - 4) {
      px = Math.max(FONT_MIN - 2, px * ((width - 4) / w));
      ({ w, h } = measure(word.word, px));
      if (vertical) [w, h] = [h, w];
    }
    for (let step = 0; step < 1200; step++) {
      const angle = step * 0.35;
      const r = 1.1 * step;
      const x = width / 2 + r * Math.cos(angle) * 1.7;
      const y = height / 2 + r * Math.sin(angle);
      if (x - w / 2 < 1 || x + w / 2 > width - 1 || y - h / 2 < 1 || y + h / 2 > height - 1) {
        continue;
      }
      const box: Box = { x, y, w, h };
      if (boxes.some((b) => overlaps(b, box))) continue;
      boxes.push(box);
      out.push({ word, x, y, px, vertical, t });
      break;
    }
  });
  return out;
}
