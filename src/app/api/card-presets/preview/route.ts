/**
 * 卡片模板预览 API(M36 批①):preset+数据 → 真实渲染管线出 PNG,模板库页
 * 「渲染 PNG」用。与 render_card 工具的关键差异=只渲不传:返回图片字节,
 * 不写媒体库,零副作用。admin 会话独占(PAT 不得触达 AI 服务域,同 skills 口径)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AI_CONFIG_PAT_DENY } from "@/lib/ai/constants";
import { CARD_PRESET_IDS, renderPreset } from "@/lib/card/presets";
import { renderCardPng } from "@/lib/card/render";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const PreviewSchema = z.object({
  preset: z.enum(CARD_PRESET_IDS),
  data: z.unknown(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, AI_CONFIG_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = PreviewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "字段不合法(preset/data 必填)");
  const built = renderPreset(parsed.data.preset, parsed.data.data);
  if (!built.ok) return apiEnvelope(400, built.error);
  try {
    const card = await renderCardPng(built.html);
    return new NextResponse(new Uint8Array(card.png), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "x-card-width": String(card.width),
        "x-card-height": String(card.height),
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return apiEnvelope(502, e instanceof Error ? e.message : "渲染失败");
  }
}
