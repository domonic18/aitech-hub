/**
 * L0 廉价元数据预筛(M25,v1 硬编码;方案 §6):纯函数零 IO,词表常量即代码,
 * v2 配置化留评审。取向:漏杀成本高于误放——无任何命中一律 pass,人工终审兜底;
 * rejected 留痕不删,治理台可翻 rejected 视图作为规则调优反馈输入。
 *
 * 规则三分(命中即短路):
 *  1. 黑名单模式:名称/标题含营销·机构·搬运特征词 → reject(人话理由带命中词)
 *  2. 矩阵名模式:名称数字长尾/官方号特征 → reject
 *  3. 教学向信号:标题样本命中教学词 → pass(理由带命中词,人工优先看)
 *  4. 无任何命中 → pass(「无负面信号」)
 */

export type L0Verdict = "pass" | "reject";

export interface L0Input {
  /** 博主名/作者名;video 场景可空(仅标题维度) */
  name: string | null;
  /** 标题样本(博主=前5标题样本;video=单标题) */
  sampleTitles: string[];
}

export interface L0Result {
  verdict: L0Verdict;
  /** 人话理由,治理台直读(如「名称命中营销特征词:学院」) */
  reason: string;
}

/** 营销·机构·搬运特征词(名称或标题命中即 reject;词表以实现为准,v2 配置化) */
const BLACKLIST_PATTERNS: readonly string[] = [
  "学院",
  "培训",
  "官方",
  "资源",
  "合集",
  "副业",
  "引流",
  "薅羊毛",
  "网课",
  "变现",
  "接单",
  "代做",
];

/** 教学向信号词(标题命中 → pass 提权,人工终审优先看) */
const TEACHING_PATTERNS: readonly string[] = [
  "教程",
  "实战",
  "入门",
  "手把手",
  "从零",
  "源码",
  "踩坑",
  "保姆级",
  "零基础",
  "实战课",
];

/** 矩阵名模式:名称以 ≥4 位数字结尾(营销矩阵批量起名习惯:品牌+长数字尾) */
const MATRIX_NAME_TAIL = /\d{4,}$/;
/** 矩阵名模式:同品牌多号自述特征 */
const MATRIX_NAME_WORDS: readonly string[] = ["官方账号", "官方号", "主账号", "小号"];

function firstHit(text: string, patterns: readonly string[]): string | null {
  for (const p of patterns) {
    if (text.includes(p)) return p;
  }
  return null;
}

export function l0Check(input: L0Input): L0Result {
  const name = (input.name ?? "").trim();
  const titles = input.sampleTitles.map((t) => t.trim()).filter(Boolean);
  const joinedTitles = titles.join(" ");

  // 1. 黑名单:名称优先,其次标题
  const nameHit = name ? firstHit(name, BLACKLIST_PATTERNS) : null;
  if (nameHit) {
    return { verdict: "reject", reason: `名称命中营销特征词:${nameHit}` };
  }
  const titleHit = firstHit(joinedTitles, BLACKLIST_PATTERNS);
  if (titleHit) {
    return { verdict: "reject", reason: `标题命中营销特征词:${titleHit}` };
  }

  // 2. 矩阵名(仅名称维度)
  if (name) {
    const matrixWord = firstHit(name, MATRIX_NAME_WORDS);
    if (matrixWord) {
      return { verdict: "reject", reason: `名称含矩阵号特征:${matrixWord}` };
    }
    if (MATRIX_NAME_TAIL.test(name)) {
      return { verdict: "reject", reason: "名称带长数字尾,疑似矩阵批量号" };
    }
  }

  // 3. 教学向信号
  const teachingHit = firstHit(joinedTitles, TEACHING_PATTERNS);
  if (teachingHit) {
    return { verdict: "pass", reason: `标题命中教学向信号:${teachingHit}` };
  }

  // 4. 无命中:漏杀成本高于误放,放行交人工终审
  return { verdict: "pass", reason: "无负面信号" };
}
