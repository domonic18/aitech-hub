/**
 * 贴图域 Zod 契约(M41):外部入参边界校验(安全惯例);BigInt id 一律纯数字
 * 字符串入参、repo 层转 BigInt(全仓既有口径,同 topics/schemas)。标题/轻文字
 * 按码点计数([...s].length,公众号 newspic 契约口径)。
 */
import { z } from "zod";

import { isUploadsPath } from "../media/refs";

import { PIN_CONTENT_MAX, PIN_CROP_SPECS, PIN_IMAGES_MAX, PIN_TITLE_MAX } from "./constants";

const BIGINT_ID = z.string().regex(/^\d+$/, "id 须为纯数字字符串");

/** 阅读原文白名单(http/https;z.string().url 放行 javascript: 等任意 scheme,渲染进 href 即存储型 XSS) */
function httpUrl(label: string) {
  return z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, `${label}须为 http(s) 完整链接`)
    .max(500);
}

/** 码点上限校验(z.string().max 数的是 UTF-16 code unit,代理对会少算) */
function codePointMax(max: number, label: string) {
  return z.string().refine((s) => [...s].length <= max, `${label}最长 ${max} 字`);
}

export const pinCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "标题必填")
    .refine((s) => [...s].length <= PIN_TITLE_MAX, `标题最长 ${PIN_TITLE_MAX} 字(公众号上限)`),
  content: codePointMax(PIN_CONTENT_MAX, "轻文字").optional(),
  topicId: BIGINT_ID.nullable().optional(),
  readMoreUrl: httpUrl("阅读原文").nullable().optional(),
  cropSpec: z.enum(PIN_CROP_SPECS).optional(),
});
export type PinCreateInput = z.infer<typeof pinCreateSchema>;

export const pinUpdateSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "标题必填")
      .refine((s) => [...s].length <= PIN_TITLE_MAX, `标题最长 ${PIN_TITLE_MAX} 字(公众号上限)`)
      .optional(),
    content: codePointMax(PIN_CONTENT_MAX, "轻文字").optional(),
    topicId: BIGINT_ID.nullable().optional(),
    readMoreUrl: httpUrl("阅读原文").nullable().optional(),
    cropSpec: z.enum(PIN_CROP_SPECS).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "至少提供一个更新字段");
export type PinUpdateInput = z.infer<typeof pinUpdateSchema>;

/** 状态流转独立 schema(流转合法性在 repo 层按当前态校验) */
export const pinStatusSchema = z.object({
  status: z.enum(["draft", "pending", "synced", "published"]),
});

/** 添加图片:从配图工坊选版本(versionIds)或本地上传(mediaPath 已过媒体管线) */
export const pinImageAddSchema = z.union([
  z.object({
    versionIds: z
      .array(BIGINT_ID)
      .min(1, "至少选择一个工坊版本")
      .max(PIN_IMAGES_MAX, `单次最多 ${PIN_IMAGES_MAX} 张`),
  }),
  z.object({
    mediaPath: z.string().trim().min(1).max(500),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
]);
export type PinImageAddInput = z.infer<typeof pinImageAddSchema>;

/** 序列重排:全量 id 有序数组(前端拖拽后整组回传) */
export const pinImageReorderSchema = z.object({
  ids: z.array(BIGINT_ID).min(1).max(PIN_IMAGES_MAX),
});

/** AI 生成贴图(prompt 必填;张数/宽高比走 illustrate 既有枚举;
 * referencePath = 风格参照图,只收站内 uploads——外链由执行核心抓取会引入 SSRF 面) */
export const pinGenerateSchema = z.object({
  prompt: z.string().trim().min(1, "生图提示词必填").max(2000),
  aspect: z.string().trim().max(10).optional(),
  count: z.number().int().min(1).max(3).optional(),
  referencePath: z
    .string()
    .trim()
    .max(500)
    .refine(isUploadsPath, "参照图须为站内上传路径(/wp-content/uploads/…)")
    .optional(),
});
export type PinGenerateInput = z.infer<typeof pinGenerateSchema>;
