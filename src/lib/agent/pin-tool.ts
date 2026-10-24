/**
 * 贴图产出·admin 工具(M42 批③):save_topic_pin —— 把本创作的出图序列落成
 * 一张 content_pin(create-only)。执行面 createPinWithImages(单事务 + 码点硬闸),
 * 工具层只做 soft ref 与默认值:
 * - 阅读原文缺省取本创作长文的站内绝对 URL(有 linked_post 时),模型可覆盖;
 * - crop_spec 缺省 1_1(与组装台同档);参照图只收站内 uploads;
 * - 回执带 pin_id / 组装台链接 / 前台预览链接与当前创作贴图数,便于模型汇报。
 * 已存在贴图的编辑仍在组装台(本工具不改既有行——多贴图互不覆盖)。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { asciiSlugFromTitle, pinPath } from "../content/pin-path";
import { postPath } from "../content/post-path";
import { prisma } from "../db";
import { isUploadsPath } from "../media/refs";
import { PIN_CROP_SPECS } from "../pins/constants";
import { createPinWithImages } from "../pins/assemble";
import { PinError } from "../pins/repo";
import { absoluteUrl } from "../seo/site";
import { getTopic, TopicError } from "../topics/repo";

import { assertAdminThread } from "./admin-thread";
import { denyPayload } from "./topic-tool-common";

const ID_RE = /^\d{1,10}$/;

/** 阅读原文缺省:本创作长文的站内绝对 URL(软引用缺行/已软删 → 不设) */
async function defaultReadMoreUrl(linkedPostId: bigint | null): Promise<string | null> {
  if (linkedPostId === null) return null;
  const post = await prisma.post.findUnique({
    where: { id: linkedPostId },
    select: { id: true, slug: true, status: true },
  });
  if (!post || post.status === "deleted") return null;
  return absoluteUrl(postPath(post.id, post.slug));
}

export const saveTopicPinTool = tool(
  async (
    { topic_id, title, content, image_paths, reference_path, crop_spec, read_more_url },
    config,
  ) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    try {
      const topic = await getTopic(BigInt(topic_id));
      const readMoreUrl = read_more_url ?? (await defaultReadMoreUrl(topic.linkedPostId));
      const pin = await createPinWithImages({
        title,
        content,
        topicId: topic.id,
        images: image_paths,
        referenceMediaPath: reference_path ?? null,
        cropSpec: crop_spec,
        readMoreUrl,
      });
      const total = await prisma.contentPin.count({ where: { topicId: topic.id } });
      const id = pin.id.toString();
      return JSON.stringify({
        ok: true,
        pin_id: id,
        status: pin.status,
        images: image_paths.length,
        read_more_url: readMoreUrl,
        read_more_source: read_more_url ? "manual" : readMoreUrl ? "linked_post" : null,
        topic_pin_count: total,
        admin_url: `/admin/pins/${id}`,
        preview_url: absoluteUrl(pinPath(pin.id, asciiSlugFromTitle(pin.title))),
        message: `贴图 #${id} 已落草稿(本创作第 ${total} 张);精修/裁剪/公众号同步到组装台`,
      });
    } catch (e) {
      if (e instanceof TopicError || e instanceof PinError)
        return JSON.stringify({ ok: false, error: e.message });
      throw e;
    }
  },
  {
    name: "save_topic_pin",
    description:
      "把已生成的出图序列落成一张贴图(草稿,create-only):落 content_pin + 有序图片" +
      "(首图即封面)+ 参照图元数据,并把创作状态从收集中推进到已出稿。落库前已硬校验:" +
      "标题 ≤32 字(码点)、轻文字 ≤2 万、图片 1~20 张且只收站内上传路径、重复图拒。\n" +
      "- image_paths:按展示顺序传本期要用的图(来自 generate_illustration 或工作台已有的站内路径;" +
      "顺序即公众号 image_list 顺序,首图当封面)。\n" +
      "- reference_path:本次出图实际采纳的参照图(与生图时传的 reference_path 一致;" +
      "无参照则省略)。\n" +
      "- read_more_url:省略时自动取本创作长文的站内链接;本创作没有长文且需要引流时再显式传。\n" +
      "- crop_spec:首图裁剪档 1_1 / 16_9 / 2.35_1,按画面比例匹配参照图与内容,省略默认 1_1。\n" +
      "回执含 pin_id、组装台 admin_url、前台 preview_url:汇报时两个链接都给。",
    schema: z.object({
      topic_id: z.string().regex(ID_RE).describe("创作(专题)id"),
      title: z.string().trim().min(1).max(40).describe("贴图标题(公众号上限 32 字,按码点)"),
      content: z.string().max(20000).optional().describe("轻文字(公众号正文纯文本)"),
      image_paths: z
        .array(z.string().trim().min(1).max(500))
        .min(1)
        .max(20)
        .describe("有序站内图片路径(首图即封面)"),
      reference_path: z
        .string()
        .trim()
        .max(500)
        .refine((p) => isUploadsPath(p), "参照图须为站内上传路径")
        .optional()
        .describe("本次出图采纳的参照图(站内 uploads 路径)"),
      crop_spec: z.enum(PIN_CROP_SPECS).optional().describe("首图裁剪档;缺省 1_1"),
      read_more_url: z
        .string()
        .trim()
        .regex(/^https?:\/\/\S+$/, "阅读原文须为 http(s) 完整链接")
        .max(500)
        .optional()
        .describe("阅读原文链接;省略时自动取本创作长文"),
    }),
  },
);
