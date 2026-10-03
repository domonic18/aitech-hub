/**
 * 发布域入参约束(单一事实源):HTTP PUT /api/posts 与 MCP upsert_article 两个
 * 边界共用同一份 zod shape——数量/长度上限属业务约束,定义收敛在内容域,边界
 * 只引用、不自持字面量(否则两处必漂移)。默认值也在此定(images=[]、
 * publish=false),两边界解析产物一致;service 对 undefined/[] 均容忍。
 * 逐张上传不走此上限(upload_media 单张一调,无批量约束)。
 */
import { z } from "zod";

import { POST_LIMITS } from "./post-schema";

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
  publish: z.boolean().default(false),
};

export const publishUpsertSchema = z.object(publishUpsertShape);
