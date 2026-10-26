/**
 * 配图工坊·交互编辑 API(M40 批 B 建;M47 批 A 队列化——请求内禁秒级任务):
 * 三回路统一入口(mode=text 改字必选/erase 消除笔/redraw 自由重绘),bbox+指令
 * → 入 illustration-studio 队列(attempts=1 计费不重试)→ 返 jobId;GET ?job=
 * 轮询任务态(processing/done{候选整图站内路径}/failed 人话/missing 404)。
 * 候选预览态确认制不变:确认走 versions 落版本链,弃用即闲置。仅会话通道。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import {
  ILLUSTRATION_EDIT_MODES,
  enqueueIllustrationEdit,
  illustrationEditJobStatus,
} from "@/lib/ai/illustration-edit";
import { getStudioView, isValidNormalizedBbox } from "@/lib/ai/illustration-studio";

export const dynamic = "force-dynamic";

const EditSchema = z.object({
  mode: z.enum(ILLUSTRATION_EDIT_MODES),
  bbox: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\s+\d{1,3}){3}$/, "bbox 形态不合法(x1 y1 x2 y2,0-999)"),
  instruction: z.string().trim().max(500).optional(),
});

/** 入队侧发放的任务 ID 形态(防 redis 键注入;enqueueIllustrationEdit 同源) */
const JOB_ID_RE = /^illu-edit-[a-z0-9]+$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, "PAT 不能驱动编辑器(仅管理会话通道)");
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "版本 ID 不合法");
  const parsed = EditSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "编辑参数不合法(mode/bbox 必填,形态见接口约定)");
  if (!isValidNormalizedBbox(parsed.data.bbox)) return apiEnvelope(400, "bbox 坐标须在 0-999 域内");
  if (parsed.data.mode !== "erase" && !parsed.data.instruction) {
    return apiEnvelope(400, "改字与自由重绘必须给指令(消除笔可空)");
  }
  // 基准图 = 当前版本整图(路径服务侧取,客户端只给版本 ID)
  const view = await getStudioView(bigId);
  if (!view) return apiEnvelope(404, "工坊版本不存在");
  try {
    const { jobId } = await enqueueIllustrationEdit({
      versionId: bigId,
      imagePath: view.version.mediaPath,
      mode: parsed.data.mode,
      bbox: parsed.data.bbox,
      instruction: parsed.data.instruction,
    });
    return apiEnvelope(0, "enqueued", { jobId });
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}

/** 编辑任务态轮询(jobId 由 POST 返回;AiClientError 等执行异常已由 BullMQ
 * failedReason 承载,这里只做态转译,不再区分错误类) */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, "PAT 不能查询编辑任务(仅管理会话通道)");
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "版本 ID 不合法");
  const jobId = req.nextUrl.searchParams.get("job") ?? "";
  if (!JOB_ID_RE.test(jobId)) return apiEnvelope(400, "任务 ID 不合法");
  const st = await illustrationEditJobStatus(jobId);
  if (st.state === "missing") return apiEnvelope(404, "编辑任务不存在或已过期,请重新提交");
  if (st.state === "failed") return apiEnvelope(502, st.message);
  if (st.state === "done") {
    return apiEnvelope(0, "done", { state: "done", imagePath: st.imagePath });
  }
  return apiEnvelope(0, "processing", { state: "processing" });
}
