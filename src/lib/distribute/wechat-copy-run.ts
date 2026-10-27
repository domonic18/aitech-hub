/**
 * 公众号「复制公众号格式」执行侧(M31 批④备用通道):与草稿同步同一转存
 * 管线(封面 add_material + 正文图 uploadimg,publish_media_cache sha1 缓存
 * 防重),产出门 mmbiz 图链内联样式 HTML——用户粘贴进公众号编辑器正文区即得
 * 成品,图片零再上传;封面已入永久素材库(粘贴后在编辑器从素材库选择)。
 * **无码点门**(本通道的存在意义即承接超预算富稿);不写 publish_channel
 * 状态机(与草稿同步互不干扰;媒体缓存行共享,重复转存被 sha1 命中跳过)。
 * 入队口在 ./wechat-sync#enqueueWechatCopy,依赖单向 run→sync。
 */
import { prisma } from "../db";
import { logger } from "../logger";
import { CHANNEL_WECHAT } from "./channels";
import { requireReadyConfig } from "./wechat-sync";
import { renderWechatHtml } from "./wechat-html";
import { ensureCoverMedia, transloadContentImages } from "./wechat-media";
import { WECHAT_THEME_DEFAULT, getWechatTheme } from "./wechat-themes";
import type { WechatCredentials } from "./wechat-client";

export interface WechatCopyResult {
  ok: boolean;
  postId: string;
  /** mmbiz 图链内联样式 HTML(无码点门,超预算富稿本体) */
  html?: string;
  chars?: number;
  /** 封面已入公众号永久素材库(false=文章无封面,封面需人工处理) */
  coverReady?: boolean;
  reason?: string;
}

/** worker 消费:转存 + 渲染,结果走 job returnvalue 交弹窗轮询(不落库) */
export async function wechatCopyJob(data: {
  token: string;
  postId: string;
  coverPath?: string;
  theme?: string;
}): Promise<WechatCopyResult> {
  const id = data.postId;
  try {
    const postId = BigInt(id);
    const cfg = await requireReadyConfig();
    const [post, row] = await Promise.all([
      prisma.post.findUnique({
        where: { id: postId },
        select: { coverPath: true, contentMd: true },
      }),
      prisma.publishChannel.findUnique({
        where: { postId_channel: { postId, channel: CHANNEL_WECHAT } },
        select: { theme: true },
      }),
    ]);
    if (!post || !(post.contentMd ?? "").trim()) {
      return { ok: false, postId: id, reason: "文章不存在或正文非 Markdown,无法生成公众号格式" };
    }
    // 主题解析:本次覆盖 > 行快照(上次推送所用)> 渠道默认(与同步同口径)
    const themeId = getWechatTheme(
      data.theme ?? row?.theme ?? cfg.theme ?? WECHAT_THEME_DEFAULT,
    ).id;
    const creds: WechatCredentials = { appid: cfg.appid, appSecret: cfg.appSecret };
    const coverPath = data.coverPath?.trim() || post.coverPath;
    let coverReady = false;
    if (coverPath) {
      await ensureCoverMedia(creds, coverPath); // 入永久素材库(缓存命中零上传)
      coverReady = true;
    }
    const finalMd = await transloadContentImages(creds, post.contentMd ?? "");
    const { html } = renderWechatHtml(finalMd, themeId, {
      paraStyle: cfg.paraStyle,
      tocMeta: cfg.enableTocMeta,
    });
    const chars = [...html].length;
    logger.info({ event: "wechat.copy_ready", postId: id, chars, coverReady });
    return { ok: true, postId: id, html, chars, coverReady };
  } catch (e) {
    const reason = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    logger.warn({ event: "wechat.copy_failed", postId: id, error: reason });
    return { ok: false, postId: id, reason };
  }
}
