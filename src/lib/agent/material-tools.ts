/**
 * 素材接地工具面(M42 批②):让 agent 自己「先找料、再挂料」,而不是只会消费
 * 人工预先挂好的素材。search_materials 只读(电报已解读视频 / 可见文本 + 未软删
 * 文章);mount_material / unmount_material 幂等写(同素材重复挂载返回 already,
 * 不报错——模型不必先查后挂)。三只工具均验会话归属 admin(fail-closed),
 * 图/文工具同款纵深防御。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { prisma } from "../db";
import { TopicError } from "../topics/errors";
import { searchMaterials } from "../topics/material-search";
import { mountMaterial, unmountMaterial } from "../topics/materials";
import { logger } from "../logger";

import { assertAdminThread } from "./admin-thread";
import { denyPayload } from "./topic-tool-common";

const ID_RE = /^\d{1,10}$/;
const idSchema = z.string().regex(ID_RE, "须为纯数字 id");
const kindSchema = z.enum(["telegram", "post"]);

export const searchMaterialsTool = tool(
  async ({ topic_id, kind, q, limit }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    try {
      const hits = await searchMaterials({ kind, q, limit });
      // 带 topic_id 时标注已挂载,避免模型重复挂同一素材
      const mounted = new Set<string>();
      if (topic_id !== undefined) {
        const rows = await prisma.topicItem.findMany({
          where: { topicId: BigInt(topic_id) },
          select: { itemType: true, itemId: true },
        });
        for (const r of rows) mounted.add(`${r.itemType}:${r.itemId}`);
      }
      logger.info({
        event: "agent.material_search_ok",
        kind: kind ?? "all",
        hasQuery: Boolean(q),
        count: hits.length,
      });
      return JSON.stringify({
        ok: true,
        count: hits.length,
        materials: hits.map((h) => ({
          kind: h.kind,
          id: h.id.toString(),
          media_type: h.mediaType,
          title: h.title,
          meta: h.meta,
          summary: h.summary,
          url: h.url,
          published_at: h.time?.toISOString() ?? null,
          ...(topic_id !== undefined
            ? { mounted: mounted.has(`${h.kind}:${h.id.toString()}`) }
            : {}),
        })),
        note:
          "id 为纯数字素材 id;把 kind + id 传给 mount_material 挂到创作。已在素材区的" +
          "条目 mounted=true,不要再挂。摘要为节选,挂载后用 get_topic_brief 读全文/解读笔记。",
      });
    } catch (e) {
      if (e instanceof TopicError) return JSON.stringify({ ok: false, error: e.message });
      throw e;
    }
  },
  {
    name: "search_materials",
    description:
      "搜索系统内既有素材(电报已解读视频 / 可见文本、历史文章)作创作底料。关键词可空" +
      "(按最近入库)。创作前先搜:与人工已挂素材合并使用,避免凭空创作;找到后立即 " +
      "mount_material 挂载并在汇报里说明挂了哪些、为什么。",
    schema: z.object({
      kind: kindSchema.optional().describe("只搜电报(telegram)或只搜文章(post);省略=两类都搜"),
      q: z.string().trim().max(100).optional().describe("关键词(标题/摘要/解读主题/博主)"),
      limit: z.number().int().min(1).max(20).optional().describe("每类返回条数,默认 10"),
      topic_id: idSchema.optional().describe("创作 id:提供时会标注哪些素材已挂载"),
    }),
  },
);

export const mountMaterialTool = tool(
  async ({ topic_id, item_type, item_id, note }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    try {
      const topicId = BigInt(topic_id);
      const r = await mountMaterial(topicId, item_type, BigInt(item_id), note ?? null);
      const total = await prisma.topicItem.count({ where: { topicId } });
      logger.info({
        event: "agent.material_mount",
        topicId: topic_id,
        itemType: item_type,
        itemId: item_id,
        created: r.created,
      });
      return JSON.stringify({
        ok: true,
        already_mounted: !r.created,
        mounted_total: total,
        message: r.created ? "已挂载到创作素材区" : "该素材此前已挂载,未重复添加(可直接继续下一步)",
      });
    } catch (e) {
      if (e instanceof TopicError) return JSON.stringify({ ok: false, error: e.message });
      throw e;
    }
  },
  {
    name: "mount_material",
    description:
      "把一条素材挂到创作(幂等:重复挂载返回 already_mounted=true,不报错)。note 可写" +
      "写作取舍指令(如「重点用第 2 点」),会原样进写作底料。视频须已解读、电报文本须" +
      "可见且有内容、文章须未删除,否则人话拒。",
    schema: z.object({
      topic_id: idSchema.describe("创作 id"),
      item_type: kindSchema.describe("telegram=电报(视频或文本)/ post=历史文章"),
      item_id: idSchema.describe("素材 id(search_materials 返回的 id)"),
      note: z.string().trim().max(500).optional().describe("人工批注:这条素材怎么用"),
    }),
  },
);

export const unmountMaterialTool = tool(
  async ({ topic_id, item_type, item_id }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    const topicId = BigInt(topic_id);
    const removed = await unmountMaterial(topicId, item_type, BigInt(item_id));
    logger.info({
      event: "agent.material_unmount",
      topicId: topic_id,
      itemType: item_type,
      itemId: item_id,
      removed,
    });
    return JSON.stringify({
      ok: true,
      removed,
      message: removed ? "已从素材区移除" : "该素材本就未挂载,无需移除",
    });
  },
  {
    name: "unmount_material",
    description:
      "从创作素材区移除一条素材(幂等)。仅在素材与选题无关/质量不足时使用,并在汇报里说明原因。",
    schema: z.object({
      topic_id: idSchema.describe("创作 id"),
      item_type: kindSchema.describe("telegram / post"),
      item_id: idSchema.describe("素材 id"),
    }),
  },
);

export const MATERIAL_TOOLS = [searchMaterialsTool, mountMaterialTool, unmountMaterialTool];
