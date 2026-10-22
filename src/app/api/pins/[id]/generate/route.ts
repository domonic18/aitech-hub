/**
 * 贴图 AI 生成入队 API(M41):POST(prompt 必填/宽高比/张数 ≤3)→
 * illustration-studio 队列(生成 ~15-60s,attempts=1 计费不重试);完成后
 * 自动登记工坊根版本并回填贴图序列,组装台轮询 GET /api/pins/[id] 取新图。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { AiAdminError } from "@/lib/ai/errors";
import { enqueueIllustrationGenerate } from "@/lib/ai/illustration-generate";
import { pinGenerateSchema } from "@/lib/pins/schemas";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage pins";

const ID_RE = /^\d{1,10}$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!ID_RE.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = pinGenerateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, parsed.error.issues[0]?.message ?? "入参不合法");
  }
  try {
    const { jobId } = await enqueueIllustrationGenerate({
      prompt: parsed.data.prompt,
      aspect: parsed.data.aspect,
      count: parsed.data.count,
      pinId: id,
    });
    return apiEnvelope(0, "enqueued", { jobId });
  } catch (e) {
    if (e instanceof AiAdminError) {
      const status = e.code === "not_found" ? 404 : e.code === "disabled" ? 409 : 400;
      return apiEnvelope(status, e.message);
    }
    throw e;
  }
}
