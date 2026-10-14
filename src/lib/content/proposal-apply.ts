/**
 * 改稿提案应用器(M27 批⑧-d,纯函数):S/R 块在原文中定位——精确唯一命中 →
 * diff-match-patch 模糊兜底(归一相似度门槛验收)→ 未定位不阻塞其他块;
 * merge 只落接受块(按起点正序拼接,区间重叠丢弃后者防错位)。rewrite 档
 * 整档直出(无需定位)。评审面(ProposeReviewCard)消费 chunk 列表渲染
 * 逐块接受/拒绝;基线永远是调用方 getContent() 快照(提案不落笔,见
 * editor-ai-plan §2/§7)。diff-match-patch 为纯计算库,两端可运行。
 */
import { diff_match_patch } from "diff-match-patch";

import type { ProposeEditsEdit } from "@/lib/agent/edit-proposal";

/** 模糊命中相似度下限(归一 0-1;低于视为未定位,宁缺毋错) */
export const FUZZY_THRESHOLD = 0.6;

export type ChunkLocateStatus = "exact" | "fuzzy" | "miss";

export interface ProposalChunk {
  /** 入参序号(评审面与 accepted 集合的稳定键) */
  index: number;
  oldString: string;
  newString: string;
  note?: string;
  status: ChunkLocateStatus;
  /** 原文命中区间 [start,end);未定位时 -1/-1 */
  start: number;
  end: number;
}

/** dmp 实例类型(@types 包以值导出类,实例类型经 typeof 取) */
type Dmp = InstanceType<typeof diff_match_patch>;

/** dmp 实例统一口径:全文搜索窗口放宽(长文匹配),阈值兜底在自算相似度 */
function newDmp(): Dmp {
  const dmp = new diff_match_patch();
  dmp.Match_Distance = 100_000;
  dmp.Match_Threshold = 0.5;
  return dmp;
}

/** 归一相似度(1 - 编辑距离/较长边;双方为空按 0) */
function similarityOf(dmp: Dmp, a: string, b: string): number {
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 0;
  const lev = dmp.diff_levenshtein(dmp.diff_main(a, b));
  return 1 - lev / longer;
}

/**
 * S/R 块逐块定位:精确唯一命中(exact);多处命中视为歧义(miss——模型应
 * 加长 oldString 消歧);零命中走 dmp match_main 模糊兜底,命中区间相似度
 * 达门槛才收(fuzzy),否则 miss。miss 不抛错、不阻塞其他块。
 *
 * bitap 以机器字长为界(Match_MaxBits 默认 32):超长 pattern 会直接
 * throw「Pattern too long for this browser」——而 S/R 的 oldString 恒超
 * 32 字符,该异常曾在评审模态挂载期炸掉整棵渲染树(2026-10-14 生产事故)。
 * 故长块以前 Match_MaxBits 字符为锚点定位,再按整段相似度验收;兜底全程
 * try/catch,任何异常降级 miss(本函数禁止抛错)。
 */
export function locateProposals(original: string, edits: ProposeEditsEdit[]): ProposalChunk[] {
  const dmp = newDmp();
  return edits.map((e, index) => {
    const base = {
      index,
      oldString: e.oldString,
      newString: e.newString,
      ...(e.note ? { note: e.note } : {}),
    };
    const first = original.indexOf(e.oldString);
    if (first >= 0) {
      // 多处命中 = 歧义,直接 miss(不走模糊兜底——模糊必以 1.0 相似度"命中"
      // 其中一处,会静默择一,违背「oldString 须唯一」契约)
      if (original.indexOf(e.oldString, first + 1) >= 0) {
        return { ...base, status: "miss", start: -1, end: -1 };
      }
      return { ...base, status: "exact", start: first, end: first + e.oldString.length };
    }
    try {
      // 超长 pattern 不能直喂 match_main(会 throw);取头部锚点探测
      const probe =
        e.oldString.length <= dmp.Match_MaxBits
          ? e.oldString
          : e.oldString.slice(0, dmp.Match_MaxBits);
      const at = dmp.match_main(original, probe, 0);
      if (at >= 0) {
        const region = original.slice(at, at + e.oldString.length);
        if (similarityOf(dmp, region, e.oldString) >= FUZZY_THRESHOLD) {
          return { ...base, status: "fuzzy", start: at, end: at + e.oldString.length };
        }
      }
    } catch {
      // dmp 内部异常一律降级 miss(评审面为渲染路径,计算层禁止炸树)
    }
    return { ...base, status: "miss", start: -1, end: -1 };
  });
}

/**
 * 按接受集合合成新全文:仅落「已定位且被接受」的块;按起点排序,与前一接受
 * 块区间重叠的(模糊命中可能交叠)丢弃后者防错位。未接受区间保持原文。
 */
export function mergeProposals(
  original: string,
  chunks: ProposalChunk[],
  acceptedIndexes: ReadonlySet<number>,
): string {
  const located = chunks
    .filter((c) => c.status !== "miss" && acceptedIndexes.has(c.index))
    .sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  let lastEnd = 0;
  for (const c of located) {
    if (c.start < lastEnd) continue; // 区间冲突:丢弃后者
    out += original.slice(cursor, c.start) + c.newString;
    cursor = c.end;
    lastEnd = c.end;
  }
  return out + original.slice(cursor);
}
