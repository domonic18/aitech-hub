/**
 * 样例参照图库 API(M39 批③ §13.11):GET 清单 / POST multipart 上传登记。
 * admin 会话 + PAT 拒 + Origin 关一体(requireSessionActor,mutation 同守)。
 * 上传复用媒体库 uploadMedia(魔数嗅探白名单/sha1 去重),参照图独立 ≤6MB 帽
 * (§13.11 决策 1;base64 后请求体 ~1.33x,官方单图 10MB 上限内自留量)。
 */
import { type NextRequest } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { UPLOAD_FIELD } from "@/lib/media/media-schema";
import { mediaErrorResponse } from "@/app/api/media/shared";
import { uploadMedia } from "@/lib/media/service";
import {
  createWritingSample,
  deriveSampleName,
  listWritingSamples,
} from "@/lib/topics/writing-samples";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage writing samples";

/** 参照图字节帽(与执行核心 ILLUSTRATE_REFERENCE_MAX_BYTES 同值;上传侧前置拦截,
 * 保证绑定的样例图必然可被生图消费) */
const SAMPLE_MAX_BYTES = 6 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  return apiEnvelope(0, "ok", { samples: await listWritingSamples() });
}

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiEnvelope(400, "invalid multipart body");
  }
  const file = form.get(UPLOAD_FIELD);
  if (!(file instanceof File)) return apiEnvelope(400, `缺少文件字段 ${UPLOAD_FIELD}`);
  const data = new Uint8Array(await file.arrayBuffer());
  if (data.byteLength === 0) return apiEnvelope(400, "文件为空");
  if (data.byteLength > SAMPLE_MAX_BYTES) return apiEnvelope(400, "参照图单张不超过 6MB");
  try {
    const saved = await uploadMedia({
      data,
      mime: file.type || "application/octet-stream",
      filename: file.name || "upload",
    });
    const nameInput = form.get("name");
    const sample = await createWritingSample(
      deriveSampleName(typeof nameInput === "string" && nameInput.trim() ? nameInput : file.name),
      saved.path,
    );
    return apiEnvelope(0, saved.reused ? "reused" : "accepted", sample, 202);
  } catch (e) {
    return mediaErrorResponse(e);
  }
}
