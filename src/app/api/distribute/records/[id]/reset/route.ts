/**
 * POST /api/distribute/records/[id]/reset(M17 批⑤):清除同步记录的 media_id
 * 绑定——公众号后台草稿被人工删除后 draft/update 报「草稿不存在」,清绑定让
 * 下一次同步回落 draft/add 重建。会话鉴权(PAT 拒)。
 */
import { type NextRequest } from "next/server";

import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";
import { resetRecordBinding } from "@/lib/distribute/records";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionActor(req, "PAT 不能清除分发绑定");
  if (actor.kind === "reject") return actor.response;

  const { id: raw } = await params;
  if (!/^\d{1,19}$/.test(raw)) return apiEnvelope(400, "记录 id 不合法");
  const id = BigInt(raw);

  try {
    await resetRecordBinding(id);
    return apiEnvelope(0, "cleared");
  } catch (err) {
    if (err instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(err.code), err.message);
    }
    throw err;
  }
}
