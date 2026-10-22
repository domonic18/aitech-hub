/**
 * 贴图 API(M41 渠道三):GET 列表(状态分段+标题搜索+分页+分段计数)/
 * POST 新建(标题必填 ≤32 码点)。仅会话通道(PAT 不得操纵贴图,同 topics 口径)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { parseListSegment, parsePage } from "@/lib/admin/list";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { toPinListItemDto } from "@/lib/pins/dto";
import { PIN_LIST_SEGMENTS } from "@/lib/pins/constants";
import { mapPinError } from "@/lib/pins/http";
import { countPinsByStatus, createPin, listPins } from "@/lib/pins/repo";
import { pinCreateSchema } from "@/lib/pins/schemas";
import type { PinStatus } from "@/lib/pins/constants";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pins";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const sp = req.nextUrl.searchParams;
  const segment = parseListSegment(PIN_LIST_SEGMENTS, sp.get("status") ?? undefined, "all");
  const page = parsePage(sp.get("page") ?? undefined);
  const q = sp.get("q")?.trim() || undefined;
  const [{ items, total }, counts] = await Promise.all([
    listPins({
      status: segment === "all" ? undefined : (segment as PinStatus),
      page,
      q,
    }),
    countPinsByStatus(),
  ]);
  return apiEnvelope(0, "ok", {
    items: items.map(toPinListItemDto),
    total,
    counts,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = pinCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, parsed.error.issues[0]?.message ?? "入参不合法");
  }
  try {
    const pin = await createPin(parsed.data);
    return apiEnvelope(0, "created", { id: pin.id.toString() });
  } catch (e) {
    const mapped = mapPinError(e);
    if (mapped) return mapped;
    throw e;
  }
}
