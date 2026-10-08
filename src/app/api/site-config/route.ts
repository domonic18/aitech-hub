/**
 * 站点配置 API(M10 批② 单键;M12 批② 泛化多键 partial):GET 读全量;
 * PUT 保存(session 鉴权,PAT 拒绝,同 model-bindings 先例)。保存后 on-demand
 * revalidate:`/`(layout 型,首页 rail 条数/hero/标题)+ `/feed.xml`、
 * `/llms.txt`(layout 型,标题进机器订阅源;page 型打不中 route tag,M11 同款)。
 * 其余前台页的标题走各自 ISR 600s 窗口再生。
 */
import { type NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getSiteSettings, setSiteConfig, SiteConfigUpdateSchema } from "@/lib/config/site-config";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage site config";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  return apiEnvelope(0, "ok", await getSiteSettings());
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = SiteConfigUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(
      400,
      "配置不合法:条数须为整数(电报流 1-50、项目/文章 1-12)、标题 1-50 字、文案 ≤2000 字、关于页 ≤8000 字",
    );
  }
  if (Object.values(parsed.data).every((v) => v === undefined)) {
    return apiEnvelope(400, "请求体不含任何配置项");
  }
  await setSiteConfig(parsed.data);
  revalidatePath("/", "layout");
  revalidatePath("/feed.xml", "layout");
  revalidatePath("/llms.txt", "layout");
  return apiEnvelope(0, "saved", await getSiteSettings());
}
