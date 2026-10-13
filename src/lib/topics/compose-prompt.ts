/**
 * 合成纯函数(M27 批②自 compose.ts 拆出,≤350 行红线):素材拼装(笔记优先/
 * 降级短结论+要点/批注注入/文章取样)、输出契约解析、prompt 拼装、文首视频卡。
 * 零 IO,单测钉口径(compose.test.ts);编排与落稿在 ./compose。
 */
import { z } from "zod";

import { POST_LIMITS } from "../content/post-schema";
import type { ParsedTask } from "../ai/chat-json-task";
import { extractJsonBlock } from "../ai/interpret-result";

// ── 素材拼装 ────────────────────────────────────────────────

/** 合成素材块(hydrateItems 同源取数,post 块额外带摘要与正文取样) */
export interface ComposeMaterialBlock {
  kind: "telegram" | "post";
  title: string;
  blogger: string | null;
  /** 人工批注(合成取舍指令,原样注入) */
  note: string | null;
  /** 解读笔记(§4:优先;null=存量/降级轮次 → 降级拼装) */
  aiNote: string | null;
  aiSummary: string | null;
  aiPoints: string[];
  /** telegram 块:原视频链接与封面图(批①合成重构起注入,供写作引用/CTA);
   * post 块恒 null */
  videoUrl: string | null;
  coverUrl: string | null;
  /** post 块:摘要与正文取样(telegram 块恒 null) */
  excerpt: string | null;
  contentSample: string | null;
}

/** post 正文取样上限(合成只需主题级引用,不整篇灌入) */
export const COMPOSE_POST_SAMPLE_MAX = 2000;

/** aiPoints Json 列读侧归一(白名单字符串;同 feed-view 投影哲学) */
export function normalizePoints(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((p): p is string => typeof p === "string" && p.trim() !== "")
    : [];
}

/**
 * 素材区拼装:笔记优先、降级短结论+要点;人工批注紧随标题(指令对素材的
 * 约束就近可读)。空素材数组返回空串(路由层已先行 400,此处兜底)。
 */
export function buildMaterialSection(blocks: ComposeMaterialBlock[]): string {
  return blocks
    .map((b, i) => {
      const n = i + 1;
      const head =
        b.kind === "telegram"
          ? `【素材${n}·视频】《${b.title}》(博主:${b.blogger ?? "未知"})`
          : `【素材${n}·文章】《${b.title}》`;
      const lines: string[] = [head];
      if (b.note) lines.push(`人工批注:${b.note}`);
      if (b.kind === "telegram") {
        if (b.videoUrl) lines.push(`视频链接:${b.videoUrl}`);
        if (b.coverUrl) lines.push(`封面图:${b.coverUrl}`);
        if (b.aiNote) {
          lines.push(`解读笔记:\n${b.aiNote}`);
        } else {
          // 降级拼装(§4:存量素材合成时自动降级,诚实接受素材深度差异)
          if (b.aiSummary) lines.push(`短结论:${b.aiSummary}`);
          if (b.aiPoints.length > 0)
            lines.push(`要点:\n${b.aiPoints.map((p) => `- ${p}`).join("\n")}`);
        }
      } else {
        if (b.excerpt) lines.push(`摘要:${b.excerpt}`);
        if (b.contentSample) lines.push(`正文节选:\n${b.contentSample}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

// ── 输出契约与 prompt ──────────────────────────────────────

/** LLM 输出契约:标题/摘要/正文 markdown(§10-2 公众号口语化 2000±500 字由
 * prompt 约束;契约层只做结构护栏,列帽交给 parse 截断不整条判废) */
export const composeResultSchema = z.object({
  title: z.string().trim().min(1, "标题缺失"),
  excerpt: z.string().trim().default(""),
  contentMd: z.string().trim().min(100, "正文过短"),
});

export type ComposeResult = z.infer<typeof composeResultSchema>;

export function parseComposeResult(raw: string): ParsedTask<ComposeResult> {
  const block = extractJsonBlock(raw);
  if (!block) return { ok: false, error: "输出中未找到 JSON 对象" };
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch (err) {
    return {
      ok: false,
      error: `JSON 解析失败:${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
    };
  }
  const parsed = composeResultSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `结构不符:${parsed.error.issues[0]?.message ?? "unknown"}`.slice(0, 300),
    };
  }
  return {
    ok: true,
    data: {
      title: parsed.data.title.slice(0, POST_LIMITS.title),
      excerpt: parsed.data.excerpt.slice(0, POST_LIMITS.excerpt),
      contentMd: parsed.data.contentMd.slice(0, POST_LIMITS.contentMd),
    },
  };
}

export interface ComposePromptSource {
  topicTitle: string;
  positioning: string | null;
  materialsSection: string;
  /** 近期已发文章标题清单(防重复选题视角;可为空) */
  recentTitles: string[];
}

const OUTPUT_SPEC =
  "输出一个 JSON 对象,字段:title(文章标题,不超过 30 字,像公众号好标题——具体、" +
  "有钩子、信息真实,不标题党不堆砌)、excerpt(摘要,不超过 120 字,一句话说清" +
  "「这篇推荐什么、为什么值得看」)、contentMd(正文全文,markdown 格式,用 ## 二级" +
  "标题分节)。只输出 JSON,不要解释、前后缀或代码围栏。";

/**
 * 产文结构模板(M27 批①合成重构,1276 验收反馈):公众号「博主×视频」推荐短文,
 * 固定结构在代码内钉死——专题定位只做补充指令,不再决定文章形态;短段落+要点化+
 * CTA,治「新闻通稿体/大段文字/无公众号表述」三问题。批②补充:封面与文首推荐卡
 * 由系统确定性注入,LLM 只负责文字,禁止自造图片语法。
 */
const STRUCTURE_SPEC = [
  "正文必须是一篇「博主×视频」推荐短文(公众号种草体),不是新闻通稿。固定结构:",
  "1)开头钩子:不超过 80 字,用视频里最反差或最具体的一个事实/数据直接抓人,不写背景铺垫;",
  "2)## 博主是谁:2~4 句,博主的定位、风格、为什么值得关注(只依据素材,不编造履历与称号);",
  "3)## 视频讲了什么:3~4 个要点,每个要点一个独立小段且不超过 60 字,段首用 **加粗** 点出关键词;严禁把多个要点挤进同一段;",
  "4)## 值得看的理由:1~2 句金句式收束,不得虚构素材之外的评价;",
  "5)## 去看原视频:结尾引导段——自然提及视频标题,并告诉读者:点击公众号文章左下角「阅读原文」进入我们的站点,站内视频卡片可一键跳转原视频;",
  "排版纪律:系统会自动在文首注入视频推荐卡并把视频封面设为文章头图,正文从开头钩子直接起笔;全文禁止使用图片语法(![…](…)),不要复述推荐卡信息;",
  "硬约束:全文 800~1200 字(不含标题与摘要);单个自然段不超过 3 行,多用短句;禁止大段铺陈与罗列式长段;",
  "事实与观点只依据素材给出,不编造;时间/年份表述必须取自素材原文,素材未提就写「近期」,不得自行推断年份;",
  "恰当融合「人工批注」的取舍指令;全部用简体中文;正文总码点控制在 18000 以内。",
].join("\n");

export function buildComposePrompt(src: ComposePromptSource): { system: string; user: string } {
  const recent =
    src.recentTitles.length > 0
      ? `\n——近期已发布文章标题(选题/表述避免重复)——\n${src.recentTitles.map((t) => `- ${t}`).join("\n")}`
      : "";
  return {
    system: `你是头部科技公众号的主编,最擅长把视频内容写成让人愿意点开原视频的推荐短文。初稿经人工编辑定稿后才发布,请把素材中的硬信息(数据、产品名、结论、步骤)完整带到。\n${STRUCTURE_SPEC}\n${OUTPUT_SPEC}`,
    user: [
      `专题:${src.topicTitle}`,
      `创作指令(选材与口吻的补充,固定结构之上生效):${src.positioning?.trim() || "(未填写,按素材自然发挥)"}`,
      "——素材库——",
      src.materialsSection,
      recent,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * 文首推荐卡(M27 批②):确定性注入不依赖 LLM,置正文最顶。封面不进正文
 * (站点头图/公众号大图均走 post.coverPath,避免双端重复);纯文字引用卡在
 * 公众号渲染为主题色块,站点渲染为引用框。无视频素材返回 null 不注入。
 */
export function buildVideoCard(blocks: ComposeMaterialBlock[]): string | null {
  const v = blocks.find((b) => b.kind === "telegram");
  if (!v) return null;
  return (
    `> 📺 本文推荐视频:《${v.title}》· UP主:${v.blogger ?? "未知"}` +
    " ——文末「阅读原文」可进站直达原视频"
  );
}

// ── agent 管线步骤契约与 prompt(M27 批③;编排在 compose-agent)────────

const angleSchema = z.object({
  candidates: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        hook: z.string().trim().min(1),
        reason: z.string().trim().min(1),
      }),
    )
    .min(2)
    .max(3),
  chosen: z.number().int().min(1),
});

const checkSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.string().trim().min(1)).max(6).default([]),
});

/** 步骤契约公共解析(extractJsonBlock + Zod;与 parseComposeResult 同哲学) */
function parseJsonAs<T>(raw: string, schema: z.ZodType<T>): ParsedTask<T> {
  const block = extractJsonBlock(raw);
  if (!block) return { ok: false, error: "输出中未找到 JSON 对象" };
  try {
    const parsed = schema.safeParse(JSON.parse(block));
    if (!parsed.success) {
      return { ok: false, error: `结构不符:${parsed.error.issues[0]?.message ?? "unknown"}` };
    }
    return { ok: true, data: parsed.data };
  } catch (err) {
    return {
      ok: false,
      error: `JSON 解析失败:${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
    };
  }
}

export function parseAngle(raw: string): ParsedTask<z.infer<typeof angleSchema>> {
  const r = parseJsonAs(raw, angleSchema);
  // chosen 越界防护(1-based):防模型数错序号,越界整条判废走重试
  if (r.ok && r.data.chosen > r.data.candidates.length) {
    return { ok: false, error: `chosen=${r.data.chosen} 超出候选数` };
  }
  return r;
}

export function parseCheck(raw: string): ParsedTask<z.infer<typeof checkSchema>> {
  return parseJsonAs(raw, checkSchema);
}

/** 步① 选题角度择优指令(2~3 候选带钩子自选最优) */
export const ANGLE_SPEC =
  "你是公众号选题主编。基于素材给 2~3 个差异化的切入角度,每个含 title(标题方向," +
  "不超过 30 字)、hook(开头钩子,不超过 80 字,用素材里最反差或最具体的事实/数据)、" +
  "reason(为什么这个角度更让人想点开,一句话);再选出最适合的一个,chosen 填其序号" +
  "(从 1 开始)。角度必须忠于素材、不编造。只输出一个 JSON 对象,不要解释。";

/** 步③ 审稿清单(与 STRUCTURE_SPEC 硬约束同源;批①固定结构 + 批②排版纪律) */
export const CHECKLIST_SPEC = [
  '按以下清单逐项检查这篇公众号推荐短文,只输出 JSON:{"pass": boolean, "issues": string[]}',
  "1)五节齐全:开头钩子、## 博主是谁、## 视频讲了什么、## 值得看的理由、## 去看原视频;",
  "2)开头钩子不超过 80 字,直接抓人无背景铺垫;",
  "3)「视频讲了什么」3~4 个要点,每要点独立小段不超过 60 字且段首 **加粗**;单段不超过 3 行;全文 800~1200 字;",
  "4)全文没有图片语法(![…](…));结尾提及「阅读原文」;",
  "5)时间/年份表述来自素材或写「近期」,无自行推断;无编造素材之外的事实与履历。",
  "issues 每项一条具体可改的问题(指明位置与改法),最多 6 条;全部通过则 pass=true 且 issues 空数组。",
].join("\n");

/** 步④ 修订指令(只修清单问题不推倒重写;出口复用 OUTPUT_SPEC) */
const REVISE_SPEC =
  "你是严谨的公众号主编。下面的初稿经审稿清单查出了问题:在保持固定结构(开头钩子/" +
  "## 博主是谁/## 视频讲了什么/## 值得看的理由/## 去看原视频)与硬约束(800~1200 字/" +
  "单段不超过 3 行/要点段首加粗)的前提下逐条修订,只修问题不推倒重写,不引入素材" +
  "之外的新事实。\n";

/** 步④ system(修订指令 + 输出出口契约) */
export const REVISE_SYSTEM = REVISE_SPEC + OUTPUT_SPEC;
