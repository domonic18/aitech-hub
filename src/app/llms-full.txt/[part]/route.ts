import { NextResponse } from "next/server";

import { buildLlmsFullParts } from "@/lib/seo/llms";

/** llms-full-N.txt(N≥2)分页(GEO;与第 1 部分同 ISR 策略) */
export const revalidate = 3600;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ part: string }> },
): Promise<NextResponse> {
  const { part } = await params;
  const n = Number.parseInt(part, 10);
  if (!Number.isInteger(n) || n < 2) {
    return new NextResponse("Not Found\n", { status: 404 }) as NextResponse;
  }
  const parts = await buildLlmsFullParts();
  const body = parts[n - 1];
  if (!body) return new NextResponse("Not Found\n", { status: 404 }) as NextResponse;
  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  }) as NextResponse;
}
