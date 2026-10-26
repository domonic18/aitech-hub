/**
 * POST /api/pins/[id]/xhs/distribute(M49 批X1':贴图 → 小红书渠道行)。
 * 半自动模式:贴图本身即物料,发布人工;系统只创建渠道行记账(幂等)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";
import { distributePinToXhs } from "@/lib/pins/xhs";
import { enqueueXhsAutoPublish } from "@/lib/pins/xhs";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pins";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const pinId = parseBigIntId(id);
  if (pinId === null) {
    return apiEnvelope(400, "贴图 id 不合法");
  }
  const auto = (await req.json().catch(() => null)) as { auto?: boolean } | null;
  try {
    const row = await distributePinToXhs(pinId);
    if (auto?.auto === true) {
      // M49 批X3:全自动——入队发布 job(worker 调 xhs-gateway)
      await enqueueXhsAutoPublish(pinId);
      return apiEnvelope(0, "ok", { status: "pending", channel: row.channel, auto: true });
    }
    return apiEnvelope(0, "ok", { status: row.status, channel: row.channel });
  } catch (e) {
    if (e instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(e.code), e.message);
    }
    throw e;
  }
}
