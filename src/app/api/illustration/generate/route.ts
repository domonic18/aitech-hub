/**
 * 工坊「新建配图」直出 API(M41 批④):POST(prompt 必填/宽高比/张数 ≤3)→
 * illustration-studio 队列,出图即登记根版本(不带 pinId,不回填任何贴图);
 * 列表页轮询刷新即可见。与组装台 /api/pins/[id]/generate 同一任务管线,
 * 差异仅在是否携带 pinId(见 illustration-generate.ts)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { enqueueIllustrationGenerate } from "@/lib/ai/illustration-generate";
import { pinGenerateSchema } from "@/lib/pins/schemas";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, "PAT 不能触发生图(仅管理会话通道)");
  if (actor.kind === "reject") return actor.response;
  const parsed = pinGenerateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, parsed.error.issues[0]?.message ?? "入参不合法");
  }
  try {
    const { jobId } = await enqueueIllustrationGenerate({
      prompt: parsed.data.prompt,
      aspect: parsed.data.aspect,
      count: parsed.data.count,
    });
    return apiEnvelope(0, "enqueued", { jobId });
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
