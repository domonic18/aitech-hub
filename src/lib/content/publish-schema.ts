/**
 * 发布域入参约束(单一事实源):HTTP PUT /api/posts 与 MCP upsert_article 两个
 * 边界共用同一份 zod shape——数量/长度上限属业务约束,定义收敛在内容域,边界
 * 只引用、不自持字面量(否则两处必漂移)。默认值也在此定(images=[])、
 * 两边界解析产物一致;service 对 undefined/[] 均容忍。
 * 逐张上传不走此上限(upload_media 单张一调,无批量约束)。
 *
 * M71 收紧:外部通道**恒落草稿**,`publish` 直发参数已移除——发布/下架只走
 * 后台人工通道,agent 不持直发后门。
 */
import { z } from "zod";

import { CONTENT_ORIGINS, POST_LIMITS } from "./post-schema";

/** 随文图片批上限(封顶单请求体量;与 POST_LIMITS 同为内容域统一管理) */
export const PUBLISH_API_IMAGES_MAX = 20;

export const publishUpsertShape = {
  markdown: z
    .string()
    .min(1, "markdown 不能为空")
    .max(POST_LIMITS.contentMd, `正文过长(上限 ${POST_LIMITS.contentMd / 10_000} 万字符)`),
  images: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        mime: z.string().regex(/^image\//, "mime 须为 image/*"),
        dataBase64: z.string().min(1),
      }),
    )
    .max(PUBLISH_API_IMAGES_MAX, `images 最多 ${PUBLISH_API_IMAGES_MAX} 张`)
    .default([]),
  title: z.string().trim().min(1).max(POST_LIMITS.title).optional(),
  slug: z.string().max(POST_LIMITS.slug).optional(),
  categorySlug: z.string().max(100).optional(),
  /**
   * 创作方式合规标识(M71):外部通道缺省 ai_assisted——agent 产出进草稿池
   * 待人工审核,标 human 会让 AI 稿被记成人工创作(154 篇迁移旧文仍为 human,
   * 不受影响)。显式声明 human/ai_generated 时按声明取值。
   */
  contentOrigin: z.enum(CONTENT_ORIGINS).optional(),
  /**
   * 信息卡清单(M72 B1):本次落稿里的**卡片图**站内路径(正文配图不入清单)。
   * 非空时按内容域 card-embeds 同款闸校验「清单里每张卡都已嵌入正文」
   * ——渲了卡却漏嵌正文会让卡片在站内退化成普通配图。
   * 与站内 agent 通道(save_topic_draft 的 card_urls)同源同闸。
   */
  cardUrls: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
};

export const publishUpsertSchema = z.object(publishUpsertShape);
