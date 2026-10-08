/**
 * 答案文本解析(K2,纯函数):哨兵切分(正文/追问 chips)、流式可见前缀
 * (哨兵及半截哨兵扣住不外泄)、[n] 引用标注 → 上标渲染段。
 */

/** 追问分隔哨兵(prompt 与解析两侧约定,漏哨兵 → 无 chips 优雅降级) */
export const FOLLOW_SENTINEL = "###FOLLOW###";

/** 哨兵宽松变体(多/少 #:#### FOLLOW / ##FOLLOW 等,含完整尾 ###;按最早出现切) */
const SENTINEL_VARIANT = /#{2,4}\s*FOLLOW#{0,3}/;

export interface SplitAnswer {
  answer: string;
  followUps: string[];
}

/** 哨兵最早出现位置(精确哨兵与宽松变体取先;无 → -1) */
function sentinelIndex(raw: string): number {
  const exact = raw.indexOf(FOLLOW_SENTINEL);
  const loose = raw.search(SENTINEL_VARIANT);
  if (exact === -1) return loose;
  if (loose === -1) return exact;
  return Math.min(exact, loose);
}

/** 流毕切分:哨兵前为正文,后逐行取追问(剥列表符/序号,去空,≤20 字,限 3 条) */
export function splitSentinel(raw: string): SplitAnswer {
  const idx = sentinelIndex(raw);
  if (idx === -1) return { answer: raw.trim(), followUps: [] };
  const answer = raw.slice(0, idx).trim();
  const followUps = raw
    .slice(idx)
    .replace(SENTINEL_VARIANT, "")
    .split("\n")
    .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((l) => l !== "")
    .slice(0, 3)
    .map((l) => (l.length > 20 ? l.slice(0, 20) : l));
  return { answer, followUps };
}

/**
 * 流式可见前缀:哨兵及之后全部扣住;尾部「可能是半截哨兵」的后缀同样扣住
 * (如已收到 "###FOL"),防止哨兵分帧泄漏给前台。
 */
export function visiblePrefix(raw: string): string {
  const idx = sentinelIndex(raw);
  const before = idx === -1 ? raw : raw.slice(0, idx);
  const maxSuffix = Math.min(before.length, FOLLOW_SENTINEL.length - 1);
  for (let len = maxSuffix; len > 0; len--) {
    if (FOLLOW_SENTINEL.startsWith(before.slice(before.length - len))) {
      return before.slice(0, before.length - len);
    }
  }
  return before;
}

export type SupSegment = string | { sup: number[] };

/** [1]/[12] 连续引用组合并为上标渲染段(纯文本段原样保留;禁 dangerouslySetInnerHTML) */
export function parseAnswerSup(text: string): SupSegment[] {
  const segs: SupSegment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const m = /^\[(\d{1,2})\]/.exec(text.slice(i));
    if (m) {
      const nums = [Number(m[1])];
      // 相邻引用(零或空白间隔)并入同一上标:[1][2] / [1] [2] → sup [1,2]
      let j = i + m[0].length;
      for (;;) {
        const ws = /^\s*/.exec(text.slice(j))![0];
        const next = /^\[(\d{1,2})\]/.exec(text.slice(j + ws.length));
        if (!next) break;
        nums.push(Number(next[1]));
        j += ws.length + next[0].length;
      }
      if (plain !== "") {
        segs.push(plain);
        plain = "";
      }
      segs.push({ sup: nums });
      i = j;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  if (plain !== "") segs.push(plain);
  return segs;
}
