/**
 * get_topic_brief 实现(M42 批③自 topic-tools 拆出,控文件行数):专题定位 +
 * 素材全集(分析底料)+ 关联文档现状 + 双产物区(贴图配置/既有贴图/参照候选/
 * 已挂素材键)+ 绑定技能预装。实现细节见各内联注释;工具面清单与 re-export
 * 维持 topic-tools 单入口。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { AI_PURPOSE_ILLUSTRATE } from "../ai/constants";
import { getEnabledSkillByKey } from "../ai/agent-skills-admin";
import { resolveAiModel } from "../ai/resolver";
import { prisma } from "../db";
import {
  buildComposeBlocks,
  listRecentPublishedTitles,
  needsRecomposeConfirm,
  transferVideoCovers,
} from "../topics/compose";
import { getTopic } from "../topics/repo";
import { parseWritingText, skipCoverGeneration } from "../topics/writing-config";

import { assertAdminThread } from "./admin-thread";
import { buildPinBrief } from "./topic-pin-brief";
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
      // 修 3 守卫对称:图文为主但 illustrate 未绑定时开工前即告警(路径不可用
      // 提前暴露,不再等调用时才爆)
      const visualMode = parseWritingText(topic.positioning).selection.visual;
      // 样例参照图(M39 批③):soft ref,行已删即 null(应用层完整性)
      const sampleImage =
        topic.sampleImageId != null
          ? await prisma.writingSampleImage.findUnique({
              where: { id: topic.sampleImageId },
              select: { id: true, name: true, mediaPath: true },
            })
          : null;
      const illustrationWarning =
        visualMode === "illustrate" && (await resolveAiModel(AI_PURPOSE_ILLUSTRATE)) === null
          ? "本专题写作配置为「文生图图文为主」,但「插图配图(illustrate)」尚未绑定生图模型:本次无法生成带字图文——先到 AI 配置完成任务绑定再开工,或把写作配置改回「信息卡为主」"
          : null;
      // M42 创作中心:双产物 brief(贴图配置/既有贴图/参照候选/已挂素材键)
      const pinBrief = await buildPinBrief(topic, { blocks, coverAssets });
      return JSON.stringify({
        topic: {
          id: topic.id.toString(),
          title: topic.title,
          positioning: topic.positioning,
          status: topic.status,
          skill_key: topic.skillKey,
          composed_at: topic.composedAt?.toISOString() ?? null,
          /** 主意图(article | pin):决定本次默认产出分支,但不限制另一种产出 */
          output_type: topic.outputType,
        },
        ...pinBrief,
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
                "本专题写作配置为「文生图图文为主」:正文配图以 generate_illustration 图文为主艺(先按内容编排呈现形态,再带字生成;形态不设限),数据密集小节仍可配 render_card 信息卡;不要整篇走 HTML 卡" +
                (sampleImage
                  ? `。样例参照图《${sampleImage.name}》已就位:每次 generate_illustration 都把 reference_path 设为 ${sampleImage.mediaPath},出图即向参照图风格靠拢(prompt 风格锚定句写「保持与参考图一致的视觉风格」)`
                  : ""),
            }
          : visualMode === "minimal"
            ? {
                visual_note:
                  "本专题写作配置为「少图纯文字」:至多 1 张信息卡,以文字与行内链接表达为主,不硬插图",
              }
            : {}),
        sample_image: sampleImage
          ? {
              id: sampleImage.id.toString(),
              name: sampleImage.name,
              media_path: sampleImage.mediaPath,
            }
          : null,
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
            // M42:电报素材分型(video/text),文本素材以原文摘要为底料
            media_type: b.mediaType,
            title: b.title,
            blogger: b.blogger,
            note: b.note,
            video_url: b.videoUrl,
            cover_path: coverPath,
            ...(b.aiTopic !== null ? { ai_topic: b.aiTopic } : {}),
            ...(b.keywords.length > 0 ? { keywords: b.keywords } : {}),
            ...(b.aiNote !== null
              ? { note_md: b.aiNote.slice(0, BRIEF_NOTE_MAX) }
              : { summary: b.aiSummary ?? b.summary, points: b.aiPoints }),
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
      "禁止在正文引用)。另含双产物区:topic.output_type(主意图)、pin_config(贴图" +
      "配置:张数/比例/裁剪/风格)、existing_pins(本创作已有贴图)、" +
      "reference_candidates(出图参照候选,仅站内路径)、mounted_keys(已挂素材键," +
      "挂素材前先比对避免重复)。写作/出贴图前必调;仔细分析素材后再选题与生产。",
    schema: z.object({
      topic_id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe("创作 id(创作中心详情页 URL 中的数字 id)"),
    }),
  },
);
