/**
 * POST /api/distribute/wechat/preview(M17 主题扩展批⑧):同步弹窗右侧预览。
 * 按文章当前 Markdown 以指定主题渲染内联样式 HTML(与推送管线同一 renderWechatHtml
 * 纯函数;图片仍为站内地址,推送时才转存微信)。不触碰微信 API、不写库;
 * 生效主题 = 请求指定 > 行快照 > 渠道默认,随响应回传供弹窗回显。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { parsePostId } from "@/lib/content/posts-admin";
import { CHANNEL_WECHAT } from "@/lib/distribute/channels";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";
import { renderWechatHtml } from "@/lib/distribute/wechat-html";
import { getWechatTheme, WECHAT_THEME_IDS } from "@/lib/distribute/wechat-themes";
import { WECHAT_CONFIG_ID } from "@/lib/distribute/wechat-config-admin";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const previewInputSchema = z.object({
  postId: z.string().regex(/^\d{1,19}$/),
  theme: z.enum(WECHAT_THEME_IDS).optional(),
});

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能预览公众号正文");
  if (actor.kind === "reject") return actor.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = previewInputSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  const id = parsePostId(parsed.data.postId);
  if (id === null) return apiEnvelope(400, "postId 不合法");

  try {
    const [post, channel, cfg] = await Promise.all([
      prisma.post.findUnique({ where: { id }, select: { contentMd: true } }),
      prisma.publishChannel.findUnique({
        where: { postId_channel: { postId: id, channel: CHANNEL_WECHAT } },
        select: { theme: true },
      }),
      prisma.wechatConfig.findUnique({ where: { id: WECHAT_CONFIG_ID }, select: { theme: true } }),
    ]);
    if (!post) throw new DistributeError("not_found", "文章不存在");
    if (!(post.contentMd ?? "").trim()) {
      throw new DistributeError("invalid", "旧文(HTML 保真正文)暂不支持预览:请先转写为 Markdown");
    }
    const theme = getWechatTheme(parsed.data.theme ?? channel?.theme ?? cfg?.theme).id;
    const { html } = renderWechatHtml(post.contentMd ?? "", theme);
    return apiEnvelope(0, "ok", { html, theme });
  } catch (err) {
    if (err instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(err.code), err.message);
    }
    throw err;
  }
}
