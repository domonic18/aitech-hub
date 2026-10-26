/**
 * 发现词库 API(M25 批③治理台):GET 列表(分段+分页+状态计数);
 * POST 人工加词(归一 trim+lower,origin=manual 直接生效;重复词 409 带当前
 * 状态)。仅会话通道(PAT 不得操纵发现词库,同 bloggers/channels 口径)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseListSegment, parsePage } from "@/lib/admin/list";
import { addManualKeyword, listKeywordsAdmin } from "@/lib/discovery/admin";
import {
  KEYWORD_LIST_SEGMENTS,
  KEYWORD_STATUS_LABELS,
  WORD_MAX_LEN,
  type KeywordStatus,
} from "@/lib/discovery/status";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage discovery keywords";

const CreateSchema = z.object({
  word: z.string().trim().min(1, "词不能为空").max(WORD_MAX_LEN, `词最长 ${WORD_MAX_LEN} 字符`),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const sp = req.nextUrl.searchParams;
  const result = await listKeywordsAdmin({
    segment: parseListSegment(KEYWORD_LIST_SEGMENTS, sp.get("status") ?? undefined, "all"),
    page: parsePage(sp.get("page") ?? undefined),
  });
  return apiEnvelope(0, "ok", result);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "词不合法(1-100 字符)");
  const r = await addManualKeyword(parsed.data.word);
  if (!r.created) {
    const label = KEYWORD_STATUS_LABELS[r.existingStatus as KeywordStatus] ?? r.existingStatus;
    return apiEnvelope(409, `关键词已存在(当前状态:${label})`);
  }
  return apiEnvelope(0, "created", { id: r.id.toString(), word: r.word });
}
