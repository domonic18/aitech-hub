/**
 * MCP 工具注册表(M72 外部 agent 能力面):声明式单表登记
 * name/description/schema/handler,装配时一次性注册到 server。
 *
 * 为什么改声明式(2026-11-13):工具数从 8 只扩到 21 只,逐只 server.tool
 * 调用会让「工具名/入参/handler」散在多文件各处,加工具时容易漏改一处。
 * 本仓原注释的触发条件是「工具数破 10 只时改声明式注册」——本批正好越线。
 * 同时换用 SDK 1.32 官方的 registerTool(server.tool 已标 @deprecated)。
 *
 * 口径纪律:
 * - 入参形状沿用各域既有 Zod 单一事实源(不另起一套);
 * - 真正的硬闸在执行面(assemble/requireReadyConfig 等),工具层只做形状校验;
 * - 审计记事件与命中键,不记正文/大段原文;
 * - PAT 身份由 actor.kind 承载,事件名不重复编码来源。
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  ShapeOutput,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";

import type { AdminActor } from "@/lib/http/mutation-guard";

/**
 * 工具表条目(装配后的统一形状)。入参具体形状在 defineTool 调用处收窄,
 * 表内 handler 的 args 用宽形状承载——各工具的字段类型由 defineTool 的
 * 泛型在定义点保证,装配时只需一个统一签名。
 */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: ZodRawShapeCompat;
  handler: (args: ShapeOutput<ZodRawShapeCompat>, actor: AdminActor) => Promise<CallToolResult>;
}

/**
 * 登记一只工具。入参形状 S 在此定宽,handler 内 args 全类型可推断;
 * 落表时统一成宽形状(唯一一处收敛,装配层不再关心各工具字段)。
 */
export function defineTool<S extends ZodRawShapeCompat>(
  name: string,
  description: string,
  inputSchema: S,
  handler: (args: ShapeOutput<S>, actor: AdminActor) => Promise<CallToolResult>,
): McpToolDef {
  return {
    name,
    description,
    inputSchema,
    handler: handler as McpToolDef["handler"],
  };
}

/**
 * 把一张工具表注册到 server。actor 由装配层闭包注入(沿用既有惯例:
 * 每请求新建 server,actor 进每只 handler 的审计日志)。
 */
export function registerTools(
  server: McpServer,
  actor: AdminActor,
  defs: readonly McpToolDef[],
): void {
  for (const def of defs) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
      async (args) => def.handler(args as ShapeOutput<ZodRawShapeCompat>, actor),
    );
  }
}
