/**
 * 贴图产出·admin 工具(M42 批③;M46 验收批增改稿工具):
 * - save_topic_pin:把本创作的出图序列落成一张 content_pin(create-only)。
 *   执行面 createPinWithImages(单事务 + 码点硬闸),工具层只做 soft ref 与默认值:
 *   阅读原文缺省由执行面回填本贴前台自链(2026-10-24 验收反馈:发布→同步→
 *   阅读原文全链免手动;模型显式传入则覆盖),crop_spec 缺省 1_1(与组装台同档);
 *   参照图只收站内 uploads;回执带 pin_id / 组装台链接 / 前台预览链接与当前
 *   创作贴图数,便于模型汇报。
 * - update_topic_pin(2026-10-24 验收反馈:改既有贴图只能重复落新贴):修改本
 *   创作既有贴图的文字面(标题/轻文字/阅读原文/裁剪档),归属按 topic_id 硬校验;
 *   校验复用组装台同款 pinUpdateSchema(码点口径单源),执行面 repo updatePin
 *   (synced/published 拒直编,人话回传)。图片序列编辑仍归组装台。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { asciiSlugFromTitle, pinPath } from "../content/pin-path";
import { prisma } from "../db";
import { isUploadsPath } from "../media/refs";
import { PIN_CROP_SPECS } from "../pins/constants";
import { createPinWithImages } from "../pins/assemble";
import { PinError, updatePin } from "../pins/repo";
import { pinUpdateSchema } from "../pins/schemas";
import { absoluteUrl } from "../seo/site";
import { getTopic, TopicError } from "../topics/repo";

import { assertAdminThread } from "./admin-thread";
import { denyPayload } from "./topic-tool-common";

const ID_RE = /^\d{1,10}$/;

export const saveTopicPinTool = tool(
  async (
    { topic_id, title, content, image_paths, reference_path, crop_spec, read_more_url },
    config,
  ) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    try {
      const topic = await getTopic(BigInt(topic_id));
      const pin = await createPinWithImages({
        title,
        content,
        topicId: topic.id,
        images: image_paths,
        referenceMediaPath: reference_path ?? null,
        cropSpec: crop_spec,
        readMoreUrl: read_more_url ?? null,
      });
      const total = await prisma.contentPin.count({ where: { topicId: topic.id } });
      const id = pin.id.toString();
      return JSON.stringify({
        ok: true,
        pin_id: id,
        status: pin.status,
        images: image_paths.length,
        read_more_url: pin.readMoreUrl,
        read_more_source: read_more_url ? "manual" : "self",
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
      "- read_more_url:省略时自动回填本贴图的站内前台页(站点发布后「阅读原文」即可打开);" +
      "需要引流到其他文章或外站时再显式传。\n" +
      "- crop_spec:首图裁剪档 1_1 / 16_9 / 2.35_1,按画面比例匹配参照图与内容,省略默认 1_1。\n" +
      "回执含 pin_id、组装台 admin_url、前台 preview_url:汇报时两个链接都给。" +
      "create-only:修改既有贴图用 update_topic_pin,严禁为改内容再落新贴图。",
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
        .describe("阅读原文链接;省略时自动回填本贴前台页,一般省略"),
    }),
  },
);

export const updateTopicPinTool = tool(
  async ({ pin_id, topic_id, title, content, read_more_url, crop_spec }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    try {
      const topic = await getTopic(BigInt(topic_id));
      const existing = await prisma.contentPin.findUnique({ where: { id: BigInt(pin_id) } });
      if (!existing || existing.topicId !== topic.id) {
        return JSON.stringify({
          ok: false,
          error: "贴图不存在或不属于本创作:pin_id 须是本创作(existing_pins)里的贴图",
        });
      }
      const patch = {
        ...(title !== undefined ? { title } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(read_more_url !== undefined ? { readMoreUrl: read_more_url } : {}),
        ...(crop_spec !== undefined ? { cropSpec: crop_spec } : {}),
      };
      // 校验单源=组装台路由同款 schema(码点口径),报错人话直回
      const parsed = pinUpdateSchema.safeParse(patch);
      if (!parsed.success) {
        return JSON.stringify({
          ok: false,
          error: parsed.error.issues[0]?.message ?? "参数不合法",
        });
      }
      const updated = await updatePin(BigInt(pin_id), parsed.data);
      const syncedChannels = await prisma.contentPinChannel.count({
        where: { pinId: updated.id, status: "synced" },
      });
      return JSON.stringify({
        ok: true,
        pin_id: updated.id.toString(),
        status: updated.status,
        wechat_resync_needed: syncedChannels > 0,
        admin_url: `/admin/pins/${updated.id.toString()}`,
        preview_url: absoluteUrl(pinPath(updated.id, asciiSlugFromTitle(updated.title))),
        message:
          `贴图 #${updated.id.toString()} 已更新` +
          (syncedChannels > 0 ? ";公众号草稿不会自动更新,请在组装台重新同步" : ""),
      });
    } catch (e) {
      if (e instanceof TopicError || e instanceof PinError)
        return JSON.stringify({ ok: false, error: e.message });
      throw e;
    }
  },
  {
    name: "update_topic_pin",
    description:
      "修改本创作既有贴图的文字面:标题/轻文字/阅读原文/首图裁剪档,传 pin_id 与要改的" +
      "字段(至少一项)。管理员要求「改贴图内容/补充链接/改标题」类诉求一律用本工具," +
      "严禁为改内容重复落新贴图。图片序列的增删/重排/换图不在本工具,去组装台操作;" +
      "已同步/已发布贴图会被拒(先撤回待验收),已同步公众号的贴图改完需在组装台重新同步。",
    schema: z
      .object({
        pin_id: z
          .string()
          .regex(ID_RE)
          .describe("贴图 id(brief existing_pins 或此前回执里的 pin_id)"),
        topic_id: z.string().regex(ID_RE).describe("创作(专题)id,用于归属校验"),
        title: z.string().trim().min(1).max(40).optional().describe("新标题(≤32 字按码点)"),
        content: z.string().max(20000).optional().describe("新轻文字(纯文本,可整段替换)"),
        read_more_url: z
          .string()
          .trim()
          .max(500)
          .optional()
          .describe("新阅读原文链接(http/https 完整 URL)"),
        crop_spec: z.enum(PIN_CROP_SPECS).optional().describe("新首图裁剪档"),
      })
      .refine(
        (v) =>
          v.title !== undefined ||
          v.content !== undefined ||
          v.read_more_url !== undefined ||
          v.crop_spec !== undefined,
        "至少提供一个要修改的字段",
      ),
  },
);
