import { NextResponse } from "next/server";

import { buildLlmsIndex } from "@/lib/seo/llms";

/** llms.txt(GEO,requirement §3.2):站点结构 AI 目录;ISR 1h,策略同 sitemap(arch/07-frontend §3) */
export const revalidate = 3600;

export async function GET(): Promise<NextResponse> {
  const body = await buildLlmsIndex();
  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  }) as NextResponse;
}
