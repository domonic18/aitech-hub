/**
 * MCP Streamable HTTP 端点(M5-c,requirement §3.6「MCP 为壳」):
 * 鉴权在 MCP 协议层之前——Bearer PAT 校验失败一律 401 + WWW-Authenticate,
 * 不存在会话路。每请求新建 server + transport 即弃(stateless,无会话粘滞,
 * 配合容器多实例);SDK 1.32 的 Web 标准传输直接吃 Request/Response,与
 * App Router 原生贴合。GET(独立 SSE 流)/DELETE(会话终止)不导出 →
 * Next 自动 405,不留半实现。
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";

import { verifyPatToken } from "@/lib/auth/pat";
import { logger } from "@/lib/logger";
import { createMcpServer } from "@/lib/mcp/tools";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const pat = await verifyPatToken(req.headers.get("authorization"));
  if (!pat) {
    logger.warn({ event: "authz.denied", via: "pat", path: "/api/mcp" });
    return NextResponse.json(
      { code: 401, message: "invalid token", data: null },
      { status: 401, headers: { "www-authenticate": 'Bearer realm="aitech-hub"' } },
    );
  }

  const server = createMcpServer({ kind: "pat", sub: pat.sub, patId: pat.patId });
  // 不设 sessionIdGenerator = stateless;enableJsonResponse 走直连 JSON 响应
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await transport.close();
    await server.close();
  }
}
