/**
 * POST /api/distribute/wechat/copy(M31 批④):「复制公众号格式」备用通道入队
 * (202)。与草稿同步同一转存管线(封面素材库 + 正文图 mmbiz),但无码点门、
 * 不写草稿状态机——产 mmbiz 图链内联 HTML 供剪贴板,承接超预算富稿。会话
 * 鉴权(PAT 拒);进度凭 token 轮询 GET copy/[jobId]。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { parsePostId } from "@/lib/content/posts-admin";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";
import { enqueueWechatCopy } from "@/lib/distribute/wechat-sync";
import { WECHAT_THEME_IDS } from "@/lib/distribute/wechat-themes";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const copyInputSchema = z.object({
  postId: z.string().regex(/^\d{1,19}$/),
  coverPath: z.string().max(500).optional(),
  theme: z.enum(WECHAT_THEME_IDS).optional(),
});

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能使用复制公众号格式通道");
  if (actor.kind === "reject") return actor.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = copyInputSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  const id = parsePostId(parsed.data.postId);
  if (id === null) return apiEnvelope(400, "postId 不合法");

  try {
    const { coverPath, theme } = parsed.data;
    const r = await enqueueWechatCopy(id, {
      ...(coverPath !== undefined ? { coverPath } : {}),
      ...(theme !== undefined ? { theme } : {}),
    });
    return apiEnvelope(0, "accepted", r, 202);
  } catch (err) {
    if (err instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(err.code), err.message);
    }
    throw err;
  }
}
