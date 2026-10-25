/**
 * 贴图公众号同步入队 API(M41 渠道三 newspic):POST 入队(资格前置全 400
 * 人话:未配置/草稿未验收/无图片/队列中拒重);worker 完成后渠道行落 synced,
 * 组装台轮询 GET /api/pins/[id] 取渠道态。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";
import { enqueuePinWechatSync } from "@/lib/distribute/pin-wechat-sync";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pins";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "invalid id");
  try {
    const { jobId } = await enqueuePinWechatSync(bigId);
    return apiEnvelope(0, "enqueued", { jobId });
  } catch (e) {
    if (e instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(e.code), e.message);
    }
    throw e;
  }
}
