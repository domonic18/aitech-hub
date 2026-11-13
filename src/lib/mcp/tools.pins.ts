/**
 * MCP 贴图侧工具表(M72):「小绿书」贴图的建/补图/状态流转/公众号草稿同步。
 *
 * 边界口径(2026-11-13 用户拍板):
 * - 文生图不在本表——线上不暴露文生图工具,图由本地 agent 生成后经
 *   POST /api/media/ 上传拿站内路径,再走 create_pin(images:[...]);
 * - 不暴露 topicId——Topic 是站内 agent 的创作项目(positioning/skillKey/
 *   状态机 collecting→drafted),站内已明确「PAT 不得操纵创作」;
 *   外部产出的贴图不进站内创作状态机。
 *
 * 硬闸位置:标题 32 码点/图片 1..20 张/图片须站内 uploads 路径/重复图拒
 * 由执行面 assertPinAssembleInput 统一兜(人话 PinError);工具层只做
 * 入参形状校验,不重复造一套约束。
 */
import { z } from "zod";

import { isBigIntId, parseBigIntId } from "@/lib/http/parse-id";
import { logger } from "@/lib/logger";
import { isUploadsPath } from "@/lib/media/refs";
import { enqueuePinWechatSync } from "@/lib/distribute/pin-wechat-sync";
import { createPinWithImages } from "@/lib/pins/assemble";
import { PIN_IMAGES_MAX } from "@/lib/pins/constants";
import { toPinChannelDto, toPinDto, toPinImageDto, toPinListItemDto } from "@/lib/pins/dto";
import {
  addPinImages,
  countPinsByStatus,
  getPinDetail,
  listPins,
  setPinStatus,
} from "@/lib/pins/repo";
import { pinCreateSchema, pinStatusSchema } from "@/lib/pins/schemas";

import { fail, json } from "./json";
import { defineTool, type McpToolDef } from "./registry";

/** BigInt 主键入参(纯数字字符串;repo 层转 BigInt) */
const PIN_ID = z.string().refine(isBigIntId, "id 须为纯数字字符串(不超 int64 上限)");

/** 站内上传路径(媒体管线产物);外链不入——同步时 worker 会按此路径取图 */
const UPLOADS_PATH = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isUploadsPath, "图片须为站内上传路径(/wp-content/uploads/…),外链不入");

/** 贴图侧工具表(6 只) */
export const pinTools: McpToolDef[] = [
  defineTool(
    "create_pin",
    "建一张贴图(「小绿书」载体,草稿态)。图片须先上传:本地生成后 curl POST /api/media/" +
      "(字段 file,Bearer 用同一枚 PAT)取 data.path,再把站内路径按展示顺序传 images[]" +
      "(首图即封面,1..20 张,重复图拒)。标题 ≤32 码点(公众号 newspic 硬上限)。" +
      "**不传 topicId**——贴图不进站内创作项目。建完是 draft,同步公众号前须先 " +
      "set_pin_status(pending) 提交验收。",
    {
      title: pinCreateSchema.shape.title,
      content: pinCreateSchema.shape.content,
      images: z
        .array(z.string().trim().min(1).max(500))
        .min(1, "贴图至少需要 1 张图")
        .max(PIN_IMAGES_MAX, `图片最多 ${PIN_IMAGES_MAX} 张`),
      referenceMediaPath: z
        .string()
        .trim()
        .max(500)
        .refine(isUploadsPath, "参照图须为站内上传路径(/wp-content/uploads/…)")
        .optional()
        .describe("本次出图实际采纳的风格参照图(站内路径);无则省略"),
      cropSpec: pinCreateSchema.shape.cropSpec,
      readMoreUrl: pinCreateSchema.shape.readMoreUrl,
    },
    async (args, actor) => {
      try {
        const pin = await createPinWithImages({
          title: args.title,
          content: args.content,
          images: args.images,
          referenceMediaPath: args.referenceMediaPath ?? null,
          cropSpec: args.cropSpec,
          readMoreUrl: args.readMoreUrl ?? null,
          topicId: null,
        });
        const pinId = pin.id.toString();
        logger.info({
          event: "mcp.create_pin",
          actor,
          pinId,
          images: args.images.length,
          status: pin.status,
        });
        return json({ pinId, status: pin.status, readMoreUrl: pin.readMoreUrl });
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "add_pin_images",
    "给已有贴图补图(追加到序列尾,站内上传路径;单次最多 20 张)。" +
      "已同步/已发布的贴图禁止直编——须先 set_pin_status(pending) 撤回。",
    {
      pinId: PIN_ID,
      mediaPath: UPLOADS_PATH,
    },
    async (args, actor) => {
      const id = parseBigIntId(args.pinId);
      if (id === null) return json({ error: "贴图 id 非法" }, true);
      try {
        const added = await addPinImages(id, { mediaPath: args.mediaPath });
        logger.info({ event: "mcp.add_pin_images", actor, pinId: args.pinId, added });
        return json({ added });
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "set_pin_status",
    "流转贴图状态:draft→pending(提交验收,同步公众号的前置)、pending→draft(撤回继续组装)、" +
      "pending→published / synced→published(站点上架)、synced/published→pending(下架改稿)。" +
      "非法流转会被拒(如 draft→synced)。",
    {
      pinId: PIN_ID,
      status: pinStatusSchema.shape.status,
    },
    async (args, actor) => {
      const id = parseBigIntId(args.pinId);
      if (id === null) return json({ error: "贴图 id 非法" }, true);
      try {
        const pin = await setPinStatus(id, args.status);
        logger.info({ event: "mcp.set_pin_status", actor, pinId: args.pinId, status: pin.status });
        return json({ status: pin.status });
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "sync_pin_to_wechat",
    "把贴图推成公众号图片消息草稿(进草稿箱,不直接发布)。前置:贴图已验收(非 draft)、" +
      "至少 1 张图。返回 jobId + token,用 get_distribute_job 轮询进度。" +
      "已在同步队列中的贴图会被拒(勿重试风暴)。",
    { pinId: PIN_ID },
    async (args, actor) => {
      const id = parseBigIntId(args.pinId);
      if (id === null) return json({ error: "贴图 id 非法" }, true);
      try {
        const { jobId, token } = await enqueuePinWechatSync(id);
        logger.info({ event: "mcp.sync_pin_to_wechat", actor, pinId: args.pinId, jobId });
        return json({ jobId, token });
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "get_pin",
    "取贴图详情:标题/轻文字/状态/裁剪档/阅读原文、图片序列(站内路径与顺序)、" +
      "各渠道行状态(wechat 行带 mediaId 与同步时间,据此判断是否已同步)。",
    { pinId: PIN_ID },
    async (args, actor) => {
      const id = parseBigIntId(args.pinId);
      if (id === null) return json({ error: "贴图 id 非法" }, true);
      const pin = await getPinDetail(id);
      logger.info({ event: "mcp.get_pin", actor, pinId: args.pinId, found: pin !== null });
      if (!pin) return json({ error: "not found", pinId: args.pinId }, true);
      return json({
        ...toPinDto(pin, pin.images.length),
        images: pin.images.map(toPinImageDto),
        channels: pin.channels.map(toPinChannelDto),
      });
    },
  ),

  defineTool(
    "list_pins",
    "列贴图(工作台视角):status 过滤(draft/pending/synced/published)、q 按标题模糊匹配、" +
      "page 翻页;counts 给各状态的数量分布。列表项含首图封面路径。",
    {
      status: z.enum(["all", "draft", "pending", "synced", "published"]).default("all"),
      q: z.string().max(100).optional().describe("标题模糊匹配"),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(50).default(20).describe("每页条数"),
    },
    async (args, actor) => {
      const { items, total } = await listPins({
        ...(args.status !== "all" ? { status: args.status } : {}),
        ...(args.q !== undefined ? { q: args.q } : {}),
        page: args.page,
        pageSize: args.limit,
      });
      const counts = await countPinsByStatus();
      logger.info({
        event: "mcp.list_pins",
        actor,
        status: args.status,
        q: args.q ?? null,
        page: args.page,
        total,
      });
      return json({
        total,
        page: args.page,
        counts,
        items: items.map(toPinListItemDto),
      });
    },
  ),
];
