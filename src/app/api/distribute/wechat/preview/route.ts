/**
 * POST /api/distribute/wechat/preview(M17 主题扩展批⑧):同步弹窗右侧预览。
 * 按文章当前 Markdown 以指定主题渲染内联样式 HTML(与推送管线同一 renderWechatHtml
 * 纯函数;图片仍为站内地址,推送时才转存微信)。不触碰微信 API、不写库;
 * 生效主题 = 请求指定 > 行快照 > 渠道默认,随响应回传供弹窗回显。
 *
 * M72:渲染组合抽到 lib/distribute/wechat-preview.ts(与 MCP 工具同源,
 * 保证「预览 = 草稿」),本路由只做鉴权与入参校验。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { parsePostId } from "@/lib/content/posts-admin";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";
import { renderWechatPreview } from "@/lib/distribute/wechat-preview";
import { WECHAT_THEME_IDS } from "@/lib/distribute/wechat-themes";
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
    const { html, theme } = await renderWechatPreview(id, parsed.data.theme);
    return apiEnvelope(0, "ok", { html, theme });
  } catch (err) {
    if (err instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(err.code), err.message);
    }
    throw err;
  }
}
