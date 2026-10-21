/**
 * 专题文章生产·admin 细粒度工具面(M27 批⑤建;批⑥补正文配图分配面):
 * 编排权移交会话 agent——模型按系统提示工作流自主规划(write_todos)并逐工具
 * 执行:get_topic_brief(素材全集 + 封面已转存为站内路径的分配面,配图工艺
 * visual_mode 结构化透出)→
 * transfer_video_cover(全量封面转存,重试/补传钮)/ generate_cover_candidates
 * (文生图封面候选,复用 M14 cover-gen 管线;M39 批④ 起只服务封面,正文概念
 * 图归 generate_illustration)/ generate_illustration
 * (文生图插画,M39 批④,走 illustrate 角色绑定)→ save_topic_draft
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
import { AI_PURPOSE_ILLUSTRATE } from "../ai/constants";
import { resolveAiModel } from "../ai/resolver";
import { getEnabledSkillByKey } from "../ai/agent-skills-admin";
import { prisma } from "../db";
import {
  buildComposeBlocks,
  listRecentPublishedTitles,
  needsRecomposeConfirm,
  transferVideoCovers,
} from "../topics/compose";
import { getTopic, TopicError } from "../topics/repo";
import { parseWritingText, skipCoverGeneration } from "../topics/writing-config";
import { logger } from "../logger";

import { assertAdminThread } from "./admin-thread";
import { generateIllustrationTool } from "./illustrate-tool";
import { pollUntil } from "./poll";
import { saveTopicDraftTool } from "./topic-draft-tool";
import { BRIEF_NOTE_MAX, denyPayload, humanizeTopicError } from "./topic-tool-common";

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
      // 绑定技能预装(deepagents pinned skills 同款:编排层已确知适用技能时
      // 确定性注入全文,不等模型自发 get_skill;内容来自 agent_skill 资产,
      // 后台改指南即时生效,提示词零硬编码)
      const boundSkill = topic.skillKey ? await getEnabledSkillByKey(topic.skillKey) : null;
      // 封面图勾选(M39 批④+):结构化标记 + 人话 note 双披露(弱模型纪律;
      // 工具层另有硬守卫,此处防无效调用尝试)
      const coverSkip = skipCoverGeneration(topic.positioning);
      // 配图工艺结构化(M39 §13.7 修 1):写作配置的 visual 维从 prose 条款行
      // 升格为结构化字段,编排侧分流以本字段为准,不再要求模型重读条款文本;
      // 修 3 守卫对称:插画为主但 illustrate 未绑定时开工前即告警(路径不可用
      // 提前暴露,不再等调用时才爆)
      const visualMode = parseWritingText(topic.positioning).selection.visual;
      const illustrationWarning =
        visualMode === "illustrate" && (await resolveAiModel(AI_PURPOSE_ILLUSTRATE)) === null
          ? "本专题写作配置为「文生图插画为主」,但「插图配图(illustrate)」尚未绑定生图模型:本次无法生成插画——先到 AI 配置完成任务绑定再开工,或把写作配置改回「信息卡为主」"
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
        skill: boundSkill
          ? {
              key: boundSkill.key,
              name: boundSkill.name,
              scenario: boundSkill.scenario,
              guide_md: boundSkill.guideMd,
            }
          : null,
        note: boundSkill
          ? `绑定技能《${boundSkill.name}》已随本载荷自动装载,起草/自评审/改稿全程以其为准,无需再 get_skill`
          : topic.skillKey
            ? `绑定技能 ${topic.skillKey} 不存在或已停用,动笔前先 list_skills 匹配并 get_skill 取指南`
            : "专题未绑定技能,动笔前先 list_skills 按场景匹配,命中即 get_skill 取指南",
        skip_cover_generation: coverSkip,
        visual_mode: visualMode,
        ...(visualMode === "illustrate"
          ? {
              visual_note:
                "本专题写作配置为「文生图插画为主」:正文配图以 generate_illustration 插画为主艺(概念/场景/氛围),数据密集小节仍可配 render_card 信息卡;不要整篇走 HTML 卡",
            }
          : visualMode === "minimal"
            ? {
                visual_note:
                  "本专题写作配置为「少图纯文字」:至多 1 张信息卡,以文字与行内链接表达为主,不硬插图",
              }
            : {}),
        ...(illustrationWarning ? { illustration_warning: illustrationWarning } : {}),
        ...(coverSkip
          ? {
              cover_note:
                "本专题写作配置取消勾选了「生成封面图」:全程不要生成封面,save_topic_draft 不要传 cover_path(保留现有封面);正文概念图用 generate_illustration",
            }
          : {}),
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
      "读取专题的完整生产底料:专题定位、绑定技能(topic.skill_key 已自动随载荷全文" +
      "装载,字段 skill)、挂载素材(博主/视频/解读笔记/要点/人工批注/站内文章节选)、" +
      "关联文档现状(含是否被人工编辑过)与近期已发文章标题(防重复选题)。视频封面" +
      "已自动转存为站内路径(materials[].cover_path,仅系统注入文首推荐卡用," +
      "禁止在正文引用)。写专题文章前必调;仔细分析素材后再选题与写作。",
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
      "为 null(转存失败)或 brief 之后新挂了素材时使用;返回的路径仅作系统注入" +
      "文首推荐卡与 save_topic_draft 的 cover_path(文章头图)供给,禁止在正文中引用。",
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
      // 封面图勾选守卫(M39 批④+,硬约束):写作配置取消「生成封面图」的专题
      // 直接拒绝,免弱模型无视 brief 标记白烧计费;正文概念图指引改走插画工具
      if (skipCoverGeneration(topic.positioning)) {
        return JSON.stringify({
          ok: false,
          error:
            "本专题写作配置取消勾选了「生成封面图」:不生成封面,保留现有封面;" +
            "正文概念/场景图请改用 generate_illustration",
        });
      }
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
      "返回站内路径列表,供封面选用。brief 的 skip_cover_generation=true(写作配置" +
      "取消勾选封面图)时本工具会拒绝,此时不要生成封面、保留现有封面;正文小节的" +
      "概念/场景配图不走本工具,改用 generate_illustration。prompt 描述期望的画面" +
      "主体与风格,省略则按专题标题自动生成。",
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
// 「工具同入口」的消费面(agent.ts / 单测)不漂移。generate_illustration
// (M39 批④)实现落 illustrate-tool,文生图插画走 illustrate 角色绑定。
export { saveTopicDraftTool };

export const TOPIC_TOOLS = [
  getTopicBriefTool,
  transferVideoCoverTool,
  generateCoverCandidatesTool,
  generateIllustrationTool,
  saveTopicDraftTool,
];
