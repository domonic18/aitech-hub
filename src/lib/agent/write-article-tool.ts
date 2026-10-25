/**
 * write_article·撰写文章单任务(2026-10-17 验收反馈):起草从编排模型剥离,
 * 捆绑为一只自足工具——编排 agent 只传选题方向/提纲/技能 key,工具内部装配
 * 底料(getTopic + 素材块 + 指南全文)喂「文章写作(writing)」独立绑定的模型,
 * 长输出预算由该模型台账 extraParams.max_tokens 决策(零 hardcode:未配置即
 * 人话报错提示补配,不静默按小预算截断)。返回初稿后编排侧照旧自评审/
 * render_card 补卡/save_topic_draft 落库;用量记 ai_usage_log role=writing。
 * 封面纪律(2026-10-17 呈现协调性反馈):视频封面不进写手底料——文首推荐卡
 * 由 save_topic_draft 落库侧确定性注入(finalizeCompose),封面图无正文用途,
 * 喂进去只会被插错位置。正文配图工艺清单以系统提示为唯一权威副本(M39
 * §13.7 修 2),此处不再维护枚举句。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { getEnabledSkillByKey } from "../ai/agent-skills-admin";
import { AI_PURPOSE_WRITING } from "../ai/constants";
import { AiAdminError, AiClientError } from "../ai/errors";
import { readExtraMaxTokens, readExtraOutputConfig } from "../ai/extra-params";
import { chatText } from "../ai/llm-client";
import { resolveAiModel } from "../ai/resolver";
import { recordAiUsage } from "../ai/usage-log";
import { buildComposeBlocks, listRecentPublishedTitles } from "../topics/compose";
import { getTopic } from "../topics/repo";
import { logger } from "../logger";

import { assertAdminThread } from "./admin-thread";
import { BRIEF_NOTE_MAX, denyPayload, humanizeTopicError } from "./topic-tool-common";

/** 写作底料里单条素材的字段形状(供 prompt 渲染与单测;无封面字段——封面
 * 只服务系统注入的文首推荐卡,进底料只会被写手插错位置) */
export interface WriterMaterial {
  kind: string;
  /** telegram 分型(M42:文本素材底料);文章恒 null */
  mediaType: "video" | "text" | null;
  title: string;
  blogger: string | null;
  note: string | null;
  videoUrl: string | null;
  /** 电报原文摘要(文本素材的主底料)与解读主题/关键词 */
  summary: string | null;
  aiTopic: string | null;
  keywords: string[];
  aiNote: string | null;
  aiSummary: string | null;
  aiPoints: string[];
  excerpt: string | null;
  contentSample: string | null;
}

export interface WriterPromptSource {
  topicTitle: string;
  positioning: string | null;
  angle: string;
  outline: string;
  guidance: string | null;
  skillGuideMd: string | null;
  recentTitles: string[];
  materials: WriterMaterial[];
}

const OUTPUT_RULES = `输出纪律:
- 只输出正文 markdown 全文,不要任何解释、前言、后记或代码围栏
- 事实与数据全部来自素材,严禁编造素材里没有的内容
- 正文不插入任何图片、不留图片/卡片占位符——文首视频推荐卡与卡图由后续流程渲染注入
- 视频类素材在对应小节给出视频原地址链接
- 全文简体中文(专有名词保留原文)`;

/** 写作 prompt 装配(纯函数,单测锚点;结构/口吻/字数策略全部住技能指南,
 * 本函数只做机制:底料拼装 + 输出纪律) */
export function buildWriterPrompt(src: WriterPromptSource): { system: string; user: string } {
  const materials = src.materials
    .map((m, i) => {
      const label = m.mediaType === "video" ? "视频" : m.kind === "post" ? "文章" : "电报图文";
      const lines = [
        `${i + 1}. [${label}] ${m.title}${m.blogger ? `(UP主:${m.blogger})` : ""}`,
        m.videoUrl ? `   视频地址:${m.videoUrl}` : null,
        m.summary ? `   原文摘要:${m.summary}` : null,
        m.aiTopic
          ? `   解读主题:${m.aiTopic}${m.keywords.length > 0 ? `(关键词:${m.keywords.join("、")})` : ""}`
          : null,
        m.note ? `   人工批注:${m.note}` : null,
        m.aiNote
          ? `   解读笔记:\n${m.aiNote
              .slice(0, BRIEF_NOTE_MAX)
              .split("\n")
              .map((l) => `   ${l}`)
              .join("\n")}`
          : m.aiSummary
            ? `   要点摘要:${m.aiSummary}${m.aiPoints.length > 0 ? `\n   要点:${m.aiPoints.join(";")}` : ""}`
            : null,
        m.excerpt ? `   文章节选:${m.excerpt}` : null,
        m.contentSample ? `   内容取样:${m.contentSample}` : null,
      ];
      return lines.filter((l): l is string => l !== null).join("\n");
    })
    .join("\n\n");
  const guide = src.skillGuideMd
    ? `\n【技能指南(结构/口吻/字数/配图节奏全程以其为准)】\n${src.skillGuideMd}\n`
    : "\n【技能指南】无适用指南,按常识写作:具体、反模板腔、简体中文\n";
  const system = `你是科技资讯网站「一起AI」(17aitech.com)的专栏作者,为指定专题撰写文章正文。${guide}
${OUTPUT_RULES}`;
  const user = [
    `【专题】${src.topicTitle}`,
    src.positioning ? `【定位】${src.positioning}` : null,
    `【选题方向】${src.angle}`,
    `【结构提纲(小节名与顺序)】\n${src.outline}`,
    src.guidance ? `【补充要求】${src.guidance}` : null,
    src.recentTitles.length > 0
      ? `【近期已发标题(避免重复选题)】${src.recentTitles.join(" / ")}`
      : null,
    `【素材清单】\n${materials}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n\n");
  return { system, user };
}

export const writeArticleTool = tool(
  async ({ topic_id, angle, outline, skill_key, guidance }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    try {
      const topic = await getTopic(BigInt(topic_id));
      const blocks = await buildComposeBlocks(topic);
      if (blocks.length === 0) {
        return JSON.stringify({ ok: false, error: "专题还没有素材,先挂载素材再写作" });
      }
      // 指南:入参 key 优先(编排侧已 get_skill 确认的那个),缺省回专题绑定
      const key = skill_key ?? topic.skillKey ?? null;
      const skill = key ? await getEnabledSkillByKey(key) : null;
      const materials: WriterMaterial[] = blocks.map((b) => ({
        kind: b.kind,
        mediaType: b.mediaType,
        title: b.title,
        blogger: b.blogger,
        note: b.note,
        videoUrl: b.videoUrl,
        summary: b.summary,
        aiTopic: b.aiTopic,
        keywords: b.keywords,
        aiNote: b.aiNote,
        aiSummary: b.aiSummary,
        aiPoints: b.aiPoints,
        excerpt: b.excerpt,
        contentSample: b.contentSample,
      }));
      const model = await resolveAiModel(AI_PURPOSE_WRITING);
      if (!model) {
        return JSON.stringify({
          ok: false,
          error: "未绑定「文章写作」模型:先到 AI 配置 → 任务绑定,给「文章写作」配主力模型后重试",
        });
      }
      // 输出预算只住台账(零 hardcode):未配置即人话报错提示补配,不静默按小预算截断
      const maxTokens = readExtraMaxTokens(model.extraParams);
      if (maxTokens === null) {
        return JSON.stringify({
          ok: false,
          error:
            "写作模型未配置输出预算:到 AI 配置 → 模型条目,在该模型的扩展参数 extraParams 里配置 max_tokens(正整数)后重试",
        });
      }
      const { system, user } = buildWriterPrompt({
        topicTitle: topic.title,
        positioning: topic.positioning,
        angle,
        outline,
        guidance: guidance ?? null,
        skillGuideMd: skill?.guideMd ?? null,
        recentTitles: await listRecentPublishedTitles(),
        materials,
      });
      const startedAt = Date.now();
      let usage = { tokensIn: 0, tokensOut: 0 };
      const draft = await chatText(
        {
          protocol: model.protocol,
          baseUrl: model.baseUrl,
          modelId: model.modelId,
          apiKey: model.apiKey,
          system,
          user,
          timeoutSec: model.timeoutSec,
          maxTokens,
          // 思考深度等供应商扩展只住台账(Kimi effort);非 anthropic 供货方不传
          outputConfig: readExtraOutputConfig(model.extraParams) ?? undefined,
        },
        (u) => {
          usage = u;
        },
      );
      await recordAiUsage({
        role: AI_PURPOSE_WRITING,
        modelId: model.id,
        modelKey: model.modelId,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        durationMs: Date.now() - startedAt,
        status: model.source === "backup" ? "degraded" : "ok",
      });
      logger.info({
        event: "agent.write_article_ok",
        topicId: topic_id,
        chars: draft.length,
        model: model.modelId,
      });
      return JSON.stringify({
        ok: true,
        draft_md: draft,
        chars: draft.length,
        model: model.modelId,
        skill_loaded: skill?.key ?? null,
        note:
          "初稿已生成。请以挑剔读者视角自评审并直接修改,render_card 卡图按 markdown_line " +
          "嵌入对应位置,终稿经 save_topic_draft 的 content_md 交付(严禁把正文整篇输出到对话流)",
      });
    } catch (e) {
      if (e instanceof AiClientError) {
        return JSON.stringify({ ok: false, error: `写作模型调用失败:${e.message}(可重试)` });
      }
      const msg = humanizeTopicError(e);
      if (msg) return JSON.stringify({ ok: false, error: msg });
      if (e instanceof AiAdminError) return JSON.stringify({ ok: false, error: e.message });
      throw e;
    }
  },
  {
    name: "write_article",
    description:
      "撰写专题文章初稿(单任务捆绑,由独立的「文章写作」模型执行,与编排模型解耦)。" +
      "传入专题 id、选题方向与结构提纲,工具自动装配素材底料与技能指南全文喂写作模型," +
      "返回正文 markdown 初稿。起草动笔前先确定选题方向与提纲;技能指南已 get_skill " +
      "时把其 skill_key 传入,工具侧自动装载指南喂写作模型。拿到初稿后自评审、嵌卡图、" +
      "再经 save_topic_draft 落库。",
    schema: z.object({
      topic_id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe("创作 id(创作中心详情页 URL 中的数字 id)"),
      angle: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .describe("选题方向:一句话说清切入角度与理由(基于素材分析自选的最优解)"),
      outline: z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .describe("结构提纲:小节名与先后顺序,可每节带一句说明"),
      skill_key: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .describe("适用技能 key(已 get_skill 的那个);省略时自动用专题绑定的技能"),
      guidance: z
        .string()
        .trim()
        .min(1)
        .max(1000)
        .optional()
        .describe("补充写作要求(如强调某条素材的数据、口吻偏好);无则省略"),
    }),
  },
);

export const WRITE_ARTICLE_TOOLS = [writeArticleTool];
