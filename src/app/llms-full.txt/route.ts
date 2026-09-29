import { NextResponse } from "next/server";

import { buildLlmsFullParts } from "@/lib/seo/llms";

/** llms-full.txt 第 1 部分(GEO;全量文章 Markdown,超长分页见文件头) */
export const revalidate = 3600;

export async function GET(): Promise<NextResponse> {
  const parts = await buildLlmsFullParts();
  if (parts.length === 0) return new NextResponse("暂无内容\n", { status: 404 }) as NextResponse;
  return new NextResponse(parts[0], {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  }) as NextResponse;
}
