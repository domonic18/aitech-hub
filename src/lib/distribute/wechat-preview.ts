/**
 * 公众号正文预览(M72 抽取):主题/段落/目录 meta 的解析与渲染组合。
 *
 * 为什么抽出来:这段逻辑原先内联在 HTTP 预览路由里——MCP 侧要「与草稿同源」
 * 的预览(agent 拿去发给主人看),若 MCP 再写一份必然与最终草稿漂移
 * (主题优先级/段落排版/目录卡任一处不同,所见即所得即破)。抽出后
 * HTTP 路由与 MCP 工具同调这一个实现。
 *
 * 口径:主题优先级「请求指定 > 渠道行快照 > 渠道默认」;正文尾部追加
 * 渠道尾注(阅读原文导流段),与推送管线同源(码点口径一致)。
 */
import { prisma } from "@/lib/db";
import { CHANNEL_WECHAT } from "@/lib/distribute/channels";
import { DistributeError } from "@/lib/distribute/errors";
import { renderWechatHtml, type WechatParaStyle } from "@/lib/distribute/wechat-html";
import { wechatTail } from "@/lib/distribute/channel-tails";
import { getWechatTheme } from "@/lib/distribute/wechat-themes";
import { WECHAT_CONFIG_ID } from "@/lib/distribute/wechat-config-admin";

export interface WechatPreviewResult {
  /** 内联样式 HTML(与最终草稿正文同源) */
  html: string;
  /** 生效主题 id(随结果回传,供调用方回显) */
  theme: string;
}

/**
 * 渲染某篇文章的公众号正文预览。
 * @param postId 文章 id
 * @param theme 请求指定的主题 id;缺省则取渠道行快照 → 渠道默认
 */
export async function renderWechatPreview(
  postId: bigint,
  theme?: string,
): Promise<WechatPreviewResult> {
  const [post, channel, cfg] = await Promise.all([
    prisma.post.findUnique({ where: { id: postId }, select: { contentMd: true } }),
    prisma.publishChannel.findUnique({
      where: { postId_channel: { postId, channel: CHANNEL_WECHAT } },
      select: { theme: true },
    }),
    prisma.wechatConfig.findUnique({
      where: { id: WECHAT_CONFIG_ID },
      select: { theme: true, paraStyle: true, enableTocMeta: true },
    }),
  ]);
  if (!post) throw new DistributeError("not_found", "文章不存在");
  if (!(post.contentMd ?? "").trim()) {
    throw new DistributeError("invalid", "旧文(HTML 保真正文)暂不支持预览:请先转写为 Markdown");
  }
  const themeId = getWechatTheme(theme ?? channel?.theme ?? cfg?.theme).id;
  // 预览=推送同源(码点口径对齐):同样追加渠道尾注(阅读原文导流段)
  const finalMd = `${post.contentMd ?? ""}\n\n${wechatTail()}`;
  const { html } = renderWechatHtml(finalMd, themeId, {
    paraStyle: (cfg?.paraStyle ?? "default") as WechatParaStyle,
    tocMeta: cfg?.enableTocMeta ?? false,
  });
  return { html, theme: themeId };
}
