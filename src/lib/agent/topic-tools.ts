/**
 * 专题文章生产·admin 细粒度工具面(M27 批⑤建;批⑥补正文配图分配面):
 * 编排权移交会话 agent——模型按系统提示工作流自主规划(write_todos)并逐工具
 * 执行:get_topic_brief(素材全集 + 封面已转存为站内路径的分配面,配图工艺
 * visual_mode 结构化透出;M39 批③ 起带样例参照图 sample_image)→
 * transfer_video_cover(全量封面转存,重试/补传钮)/ generate_cover_candidates
 * (文生图封面候选,复用 M14 cover-gen 管线;M39 批④ 起只服务封面,正文概念
 * 图归 generate_illustration)/ generate_illustration
 * (文生图图文,M39 批④建,§13.9 重定义,走 illustrate 角色绑定)→ save_topic_draft
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
import { buildComposeBlocks, transferVideoCovers } from "../topics/compose";
import { getTopic, TopicError } from "../topics/repo";
import { skipCoverGeneration } from "../topics/writing-config";
import { logger } from "../logger";

import { assertAdminThread } from "./admin-thread";
import { generateIllustrationTool } from "./illustrate-tool";
import { pollUntil } from "./poll";
import { getTopicBriefTool } from "./topic-brief-tool";
import { saveTopicDraftTool } from "./topic-draft-tool";
import { denyPayload, humanizeTopicError } from "./topic-tool-common";

/** 兼容出口:brief 实现住 topic-brief-tool(拆文件控行数),既有调用方/单测不变 */
export { getTopicBriefTool };

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
        .describe("创作 id(创作中心详情页 URL 中的数字 id)"),
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
        .describe("创作 id(创作中心详情页 URL 中的数字 id)"),
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
// (M39 批④)实现落 illustrate-tool,文生图图文走 illustrate 角色绑定。
export { saveTopicDraftTool };

export const TOPIC_TOOLS = [
  getTopicBriefTool,
  transferVideoCoverTool,
  generateCoverCandidatesTool,
  generateIllustrationTool,
  saveTopicDraftTool,
];
