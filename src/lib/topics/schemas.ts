/**
 * 专题域 Zod 契约(M26 批①):外部入参边界校验(安全惯例);BigInt id 一律
 * 纯数字字符串入参、repo 层转 BigInt(全仓既有口径,如 agent 工具 read_post)。
 */
import { z } from "zod";

import { AGENT_SKILL_KEY_RE } from "../ai/agent-skills-admin";
import { TOPIC_ITEM_TYPE, TOPIC_OUTPUT_TYPES, TOPIC_STATUS } from "./constants";

const BIGINT_ID = z.string().regex(/^\d+$/, "id 须为纯数字字符串");

export const topicCreateSchema = z.object({
  title: z.string().trim().min(1, "标题必填").max(200),
  positioning: z.string().trim().max(1000).optional(),
  /** 主意图(M42):缺省 article(存量与老客户端不带该键时落长文) */
  outputType: z.enum(TOPIC_OUTPUT_TYPES).optional(),
});
/** skillKey 为服务端派生字段(M39 批②形式回写),不在客户端 schema 内
 * (zod 剥未知键,客户端传不上来);PATCH 的 skillKey 仍走 topicUpdateSchema */
export type TopicCreateInput = z.infer<typeof topicCreateSchema> & { skillKey?: string };

export const topicUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    positioning: z.string().trim().max(1000).nullable().optional(),
    // 贴图创作配置(M42):与 positioning 独立列,互不派生
    pinPositioning: z.string().trim().max(1000).nullable().optional(),
    // 主意图切换(列表新建后仍可改;产出不因此受限)
    outputType: z.enum(TOPIC_OUTPUT_TYPES).optional(),
    linkedPostId: BIGINT_ID.nullable().optional(),
    // 绑定 agent_skill(M30 批②):null=解绑;存在性在 API 路由核(需查启用技能)
    skillKey: z
      .string()
      .trim()
      .max(50)
      .regex(AGENT_SKILL_KEY_RE, "skillKey 仅限小写字母/数字/连字符")
      .nullable()
      .optional(),
    // 样例参照图绑定(M39 批③):null=解绑;存在性在 API 路由核(soft ref 同 skillKey 口径)
    sampleImageId: BIGINT_ID.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个更新字段");
export type TopicUpdateInput = z.infer<typeof topicUpdateSchema>;

/** 状态流转独立 schema(流转合法性在 repo 层按当前态校验) */
export const topicStatusSchema = z.object({
  status: z.enum(TOPIC_STATUS),
});

export const itemMountSchema = z.object({
  itemType: z.enum(TOPIC_ITEM_TYPE),
  itemId: BIGINT_ID,
  note: z.string().trim().max(500).optional(),
});
export type ItemMountInput = z.infer<typeof itemMountSchema>;

export const itemUpdateSchema = z
  .object({
    note: z.string().trim().max(500).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个更新字段");
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;
