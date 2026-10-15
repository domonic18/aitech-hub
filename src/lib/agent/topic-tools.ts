/**
 * 专题文章生产·admin 细粒度工具面(M27 批⑤建;批⑥补正文配图分配面):
 * 编排权移交会话 agent——模型按系统提示工作流自主规划(write_todos)并逐工具
 * 执行:get_topic_brief(素材全集 + 封面已转存为站内路径的分配面)→
 * transfer_video_cover(全量封面转存,重试/补传钮)/ generate_cover_candidates
 * (文生图封面候选与概念示意图,复用 M14 cover-gen 管线)→ save_topic_draft
 * (落稿锚定核,已拆 topic-draft-tool,技术债批⑤)。
 * 过程可视性来自每只工具卡逐个出现,HITL 选题/覆盖确认走 ask_user。
 * 纵深防御:图侧工具按身份档分发(admin 独占)之外,每只工具体内再验会话行
 * 归属是 admin(fail-closed);共享基元见 topic-tool-common。
 */
import { randomUUID } from "node:crypto";

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  deleteCoverTemp,
  enqueueCoverGen,
  loadCoverPostContext,
  probeCoverGen,
  type CoverGenProbeHit,
} from "../ai/cover-generate";
import { AiAdminError } from "../ai/errors";
import { prisma } from "../db";
import {
  buildComposeBlocks,
  listRecentPublishedTitles,
  needsRecomposeConfirm,
  transferVideoCovers,
} from "../topics/compose";
import { getTopic, TopicError } from "../topics/repo";
import { logger } from "../logger";

import { assertAdminThread } from "./admin-thread";
import { pollUntil } from "./poll";
import { saveTopicDraftTool } from "./topic-draft-tool";
import { denyPayload, humanizeTopicError } from "./topic-tool-common";

/** brief 内单条解读笔记进上下文的截断宽度(素材多条叠加,单条给足不失真) */
const BRIEF_NOTE_MAX = 3000;

// ── ① get_topic_brief:专题定位 + 素材全集(分析底料)──────────────

export const getTopicBriefTool = tool(
  async ({ topic_id }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    try {
      const topic = await getTopic(BigInt(topic_id));
      const blocks = await buildComposeBlocks(topic);
      // 批⑥分配面:brief 现场全量转存视频封面,站内路径直接进 payload(模型
      // 「看得到用得上」);单条失败置 null 不阻塞,失败清单顶层随附
      const coverAssets = await transferVideoCovers(blocks);
      let coverIdx = 0;
      const linkedId = topic.linkedPostId;
      const linked =
        linkedId !== null
          ? await prisma.post.findUnique({
              where: { id: linkedId },
              select: { title: true, status: true, updatedAt: true },
            })
          : null;
      return JSON.stringify({
        topic: {
          id: topic.id.toString(),
          title: topic.title,
          positioning: topic.positioning,
          status: topic.status,
          skill_key: topic.skillKey,
          composed_at: topic.composedAt?.toISOString() ?? null,
        },
        linked_post:
          linkedId !== null && linked && linked.status !== "deleted"
            ? {
                id: linkedId.toString(),
                title: linked.title,
                status: linked.status,
                admin_url: `/admin/posts/${linkedId.toString()}`,
                edited_since_compose: needsRecomposeConfirm(topic, linked),
              }
            : null,
        materials: blocks.map((b) => {
          const coverPath =
            b.kind === "telegram" && b.coverUrl !== null
              ? (coverAssets[coverIdx++]?.coverPath ?? null)
              : null;
          return {
            kind: b.kind,
            title: b.title,
            blogger: b.blogger,
            note: b.note,
            video_url: b.videoUrl,
            cover_path: coverPath,
            ...(b.aiNote !== null
              ? { note_md: b.aiNote.slice(0, BRIEF_NOTE_MAX) }
              : { summary: b.aiSummary, points: b.aiPoints }),
            excerpt: b.excerpt,
            content_sample: b.contentSample,
          };
        }),
        cover_transfer_failed: coverAssets.filter((a) => a.coverPath === null).map((a) => a.title),
        recent_published_titles: await listRecentPublishedTitles(),
      });
    } catch (e) {
      const msg = humanizeTopicError(e);
      if (msg) return JSON.stringify({ ok: false, error: msg });
      throw e;
    }
  },
  {
    name: "get_topic_brief",
    description:
      "读取专题的完整生产底料:专题定位、绑定技能(topic.skill_key,写前经 get_skill " +
      "取指南)、挂载素材(博主/视频/解读笔记/要点/人工批注/站内文章节选)、关联文档" +
      "现状(含是否被人工编辑过)与近期已发文章标题(防重复选题)。视频封面已自动转存" +
      "为站内路径(materials[].cover_path),可直接在正文引用。写专题文章前必调;仔细" +
      "分析素材后再选题与写作。",
    schema: z.object({
      topic_id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe("专题 id(专题管理详情页 URL 中的数字 id)"),
    }),
  },
);

// ── ② transfer_video_cover:视频封面转存入站内媒体库 ──────────────

export const transferVideoCoverTool = tool(
  async ({ topic_id }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    try {
      const topic = await getTopic(BigInt(topic_id));
      const blocks = await buildComposeBlocks(topic);
      const assets = await transferVideoCovers(blocks);
      if (assets.length === 0) {
        return JSON.stringify({
          ok: false,
          error: "素材中没有视频封面图(可用 generate_cover_candidates 生成封面)",
        });
      }
      const covers = assets
        .filter((a) => a.coverPath !== null)
        .map((a) => ({ title: a.title, blogger: a.blogger, cover_path: a.coverPath }));
      if (covers.length === 0) {
        return JSON.stringify({
          ok: false,
          error: "封面转存全部失败(B 站图床防盗链、网络抖动或图片格式不支持),可稍后重试",
        });
      }
      const failed = assets.filter((a) => a.coverPath === null).map((a) => a.title);
      return JSON.stringify({ ok: true, covers, ...(failed.length > 0 ? { failed } : {}) });
    } catch (e) {
      const msg = humanizeTopicError(e);
      if (msg) return JSON.stringify({ ok: false, error: msg });
      throw e;
    }
  },
  {
    name: "transfer_video_cover",
    description:
      "转存专题全部视频素材封面入站内媒体库(B 站图床有防盗链,外链直引会裂图),返回" +
      "「标题/博主/站内路径」清单,部分失败列在 failed(标题)。brief 里 cover_path " +
      "为 null(转存失败)或 brief 之后新挂了素材时使用;返回的路径可作 " +
      "save_topic_draft 的 cover_path(文章头图/公众号大图),也可在正文中以图片语法引用。",
    schema: z.object({
      topic_id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe("专题 id(专题管理详情页 URL 中的数字 id)"),
    }),
  },
);

// ── ③ generate_cover_candidates:文生图封面候选(复用 M14 cover-gen)──

export const generateCoverCandidatesTool = tool(
  async ({ topic_id, prompt }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    let token: string;
    let jobId: string;
    try {
      const topic = await getTopic(BigInt(topic_id));
      // 关联稿正文一并供给(M31:agent 提示词步骤吃全文;无关联稿留空)
      const linkedCtx = topic.linkedPostId
        ? await loadCoverPostContext(topic.linkedPostId.toString())
        : null;
      ({ token, jobId } = await enqueueCoverGen({
        token: randomUUID(),
        postId: topic.linkedPostId?.toString() ?? null,
        title: topic.title,
        excerpt: topic.positioning ?? "",
        tags: [],
        contentMd: linkedCtx?.contentMd ?? "",
        prompt: prompt ?? "",
      }));
    } catch (e) {
      if (e instanceof AiAdminError || e instanceof TopicError) {
        return JSON.stringify({ ok: false, error: e.message });
      }
      throw e;
    }
    logger.info({ event: "agent.cover_gen_started", token });
    // 单拍探测:候选出图即收工;job 失败立刻断路(不傻等满预算,问题二)
    const outcome = await pollUntil<CoverGenProbeHit>(() => probeCoverGen(token, jobId));
    if (outcome === null) {
      return JSON.stringify({
        ok: false,
        timeout: true,
        error: "封面生成超时(云厂商生图通常 10-30 秒),可重试或改用 transfer_video_cover",
      });
    }
    if ("failure" in outcome) {
      await deleteCoverTemp(token); // 清可能的半成品临时件
      return JSON.stringify({
        ok: false,
        error: `生图失败:${outcome.failure}(可重试,或在 AI 配置调大生图模型超时)`,
      });
    }
    return JSON.stringify({
      ok: true,
      candidates: outcome.rows.map((r) => r.path),
      note: "从候选中择优,路径可作正文配图或 save_topic_draft 的 cover_path",
    });
  },
  {
    name: "generate_cover_candidates",
    description:
      "用文生图模型为专题文章生成候选图(2 张,约 10-30 秒,本工具会等待到出图)," +
      "返回站内路径列表。可为封面,也可为正文小节现拟 prompt 生成概念示意图(不限于" +
      "封面);prompt 描述期望的画面主体与风格,省略则按专题标题自动生成。",
    schema: z.object({
      topic_id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe("专题 id(专题管理详情页 URL 中的数字 id)"),
      prompt: z
        .string()
        .trim()
        .max(1000)
        .optional()
        .describe("生图提示词(画面主体/风格);省略则按专题标题与定位自动生成"),
    }),
  },
);

// save_topic_draft 实现已拆 topic-draft-tool(技术债批⑤);此处 re-export 维持
// 「四工具同入口」的消费面(agent.ts / 单测)不漂移。
export { saveTopicDraftTool };

export const TOPIC_TOOLS = [
  getTopicBriefTool,
  transferVideoCoverTool,
  generateCoverCandidatesTool,
  saveTopicDraftTool,
];
