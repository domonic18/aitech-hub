/**
 * 配图工坊·交互编辑 API(M40 批 B):三回路统一入口(mode=text 改字必选/
 * erase 消除笔/redraw 自由重绘),bbox+指令 → Seedream 交互编辑 → 候选整图
 * 站内路径(预览态确认制:确认走 versions 落版本链,弃用即闲置)。
 * 同步执行 ~15s(同 generate_illustration 口径);仅会话通道。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { AiAdminError, AiClientError, aiErrorStatus } from "@/lib/ai/errors";
import { ILLUSTRATION_EDIT_MODES, editIllustration } from "@/lib/ai/illustration-edit";
import { getStudioView, isValidNormalizedBbox } from "@/lib/ai/illustration-studio";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const EditSchema = z.object({
  mode: z.enum(ILLUSTRATION_EDIT_MODES),
  bbox: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\s+\d{1,3}){3}$/, "bbox 形态不合法(x1 y1 x2 y2,0-999)"),
  instruction: z.string().trim().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, "PAT 不能驱动编辑器(仅管理会话通道)");
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d+$/.test(id)) return apiEnvelope(400, "版本 ID 不合法");
  const parsed = EditSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "编辑参数不合法(mode/bbox 必填,形态见接口约定)");
  if (!isValidNormalizedBbox(parsed.data.bbox)) return apiEnvelope(400, "bbox 坐标须在 0-999 域内");
  if (parsed.data.mode !== "erase" && !parsed.data.instruction) {
    return apiEnvelope(400, "改字与自由重绘必须给指令(消除笔可空)");
  }
  // 基准图 = 当前版本整图(路径服务侧取,客户端只给版本 ID)
  const view = await getStudioView(BigInt(id));
  if (!view) return apiEnvelope(404, "工坊版本不存在");
  try {
    const r = await editIllustration({
      imagePath: view.version.mediaPath,
      mode: parsed.data.mode,
      bbox: parsed.data.bbox,
      instruction: parsed.data.instruction,
    });
    return apiEnvelope(0, "ok", r);
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    if (e instanceof AiClientError) return apiEnvelope(502, e.message);
    throw e;
  }
}
