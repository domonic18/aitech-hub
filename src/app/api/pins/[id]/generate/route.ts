/**
 * 贴图 AI 生成入队 API(M41;M42 批③加参照图):POST(prompt 必填/宽高比/
 * 张数 ≤3/referencePath 可选仅站内 uploads)→ illustration-studio 队列
 * (生成 ~15-60s,attempts=1 计费不重试);带参照时 prompt 自编 HEX 配色先 400
 * (守卫同 agent 工具,免得文字压过参照图还照常计费)。完成后自动登记工坊
 * 根版本并回填贴图序列,组装台轮询 GET /api/pins/[id] 取新图。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { AiAdminError } from "@/lib/ai/errors";
import { enqueueIllustrationGenerate } from "@/lib/ai/illustration-generate";
import { detectReferenceStyleConflict } from "@/lib/ai/reference-guard";
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
  // 参照风格守卫(同 agent 工具口径):带参照时 prompt 自编 HEX 配色先拒,
  // 免得文字压过参照图还照常计费
  if (parsed.data.referencePath) {
    const conflict = detectReferenceStyleConflict(parsed.data.prompt);
    if (conflict) {
      return apiEnvelope(
        400,
        `${conflict}。带参照图时视觉风格由参照图承载,请去掉配色/风格词后重新生成`,
      );
    }
  }
  try {
    const { jobId } = await enqueueIllustrationGenerate({
      prompt: parsed.data.prompt,
      aspect: parsed.data.aspect,
      count: parsed.data.count,
      pinId: id,
      referencePath: parsed.data.referencePath,
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
