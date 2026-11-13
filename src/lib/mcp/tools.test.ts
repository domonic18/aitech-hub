/**
 * MCP 工具面单测(M72,仓库首份 MCP 层测试)。
 *
 * 守三件事:
 * 1. 注册表完整性——工具名单、描述、schema 齐全(加工具漏填直接红);
 * 2. 退役/未开放的工具不得复活(M71 退役 publish/unpublish;M72 不开放
 *    文生图与批量同步;create_pin 不带 topicId);
 * 3. 入参 schema 正反例——边界在 Zod 层就该拒,不该拖到执行面才炸。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fail, json } from "./json";
import type { McpToolDef } from "./registry";
import { allTools, createMcpServer } from "./tools";

/** 期望的工具面(21 只):加工具/删工具都要改这里,改动即需复核 */
const EXPECTED_TOOLS = [
  // 只读面
  "list_hot_topics",
  "get_telegram_item",
  "search_site",
  "get_video_play_url",
  "list_signals",
  "list_categories",
  "get_wechat_config",
  // 文章面
  "upsert_article",
  "upload_media",
  "get_article",
  "list_articles",
  "sync_article_to_wechat",
  "copy_article_wechat_format",
  "get_distribute_job",
  "render_wechat_preview",
  // 贴图面
  "create_pin",
  "add_pin_images",
  "set_pin_status",
  "sync_pin_to_wechat",
  "get_pin",
  "list_pins",
] as const;

/** 不得出现的工具:退役的、用户明确不开放的 */
const FORBIDDEN_TOOLS = [
  "publish_article",
  "publish",
  "unpublish",
  "generate_pin_images",
  "sync_article_batch_to_wechat",
] as const;

function tool(name: string): McpToolDef {
  const def = allTools().find((t) => t.name === name);
  if (!def) throw new Error(`工具表里没有 ${name}`);
  return def;
}

/** 把工具的 raw shape 包成 z.object 以便单测校验 */
function schemaOf(name: string) {
  return z.object(tool(name).inputSchema as Record<string, z.ZodType>);
}

describe("MCP 工具表完整性", () => {
  it("工具名单与期望一致(21 只)", () => {
    expect(
      allTools()
        .map((t) => t.name)
        .sort(),
    ).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("工具名唯一", () => {
    const names = allTools().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("每只工具都有非空描述与入参 schema", () => {
    for (const t of allTools()) {
      expect(t.description, `${t.name} 缺描述`).toBeTruthy();
      expect(t.description.length, `${t.name} 描述过短`).toBeGreaterThan(10);
      expect(t.inputSchema, `${t.name} 缺入参 schema`).toBeTruthy();
    }
  });

  it("退役与未开放的工具不在表里", () => {
    const names = allTools().map((t) => t.name);
    for (const forbidden of FORBIDDEN_TOOLS) {
      expect(names, `${forbidden} 不应再暴露`).not.toContain(forbidden);
    }
  });

  it("create_pin 不带 topicId(外部产出不进站内创作项目)", () => {
    expect(Object.keys(tool("create_pin").inputSchema)).not.toContain("topicId");
  });
});

describe("MCP 入参 schema 边界", () => {
  it("create_pin: 缺 images / 空 images / 超 32 字标题都拒", () => {
    const s = schemaOf("create_pin");
    const img = "/wp-content/uploads/2026/11/a.png";
    expect(s.safeParse({ title: "标题", images: [img] }).success).toBe(true);
    expect(s.safeParse({ title: "标题" }).success).toBe(false);
    expect(s.safeParse({ title: "标题", images: [] }).success).toBe(false);
    expect(s.safeParse({ title: "标".repeat(32), images: [img] }).success).toBe(true);
    expect(s.safeParse({ title: "标".repeat(33), images: [img] }).success).toBe(false);
  });

  it("add_pin_images: 外链图片路径拒(站内 uploads 才入序列)", () => {
    const s = schemaOf("add_pin_images");
    expect(
      s.safeParse({ pinId: "1", mediaPath: "/wp-content/uploads/2026/11/a.png" }).success,
    ).toBe(true);
    expect(s.safeParse({ pinId: "1", mediaPath: "https://evil.example/a.png" }).success).toBe(
      false,
    );
    expect(s.safeParse({ pinId: "x", mediaPath: "/wp-content/uploads/a.png" }).success).toBe(false);
  });

  it("set_pin_status: 状态值限四态", () => {
    const s = schemaOf("set_pin_status");
    expect(s.safeParse({ pinId: "1", status: "pending" }).success).toBe(true);
    expect(s.safeParse({ pinId: "1", status: "archived" }).success).toBe(false);
  });

  it("get_distribute_job: jobId 与 token 形状受检", () => {
    const s = schemaOf("get_distribute_job");
    expect(s.safeParse({ jobId: "wechat-abc123", token: "0123abcd-01" }).success).toBe(true);
    expect(s.safeParse({ jobId: "Bad Id", token: "0123abcd-01" }).success).toBe(false);
    expect(s.safeParse({ jobId: "wechat-abc123", token: "zz" }).success).toBe(false);
  });

  it("list_signals: limit 越界拒", () => {
    const s = schemaOf("list_signals");
    expect(s.safeParse({ limit: 20 }).success).toBe(true);
    expect(s.safeParse({ limit: 1000 }).success).toBe(false);
  });
});

describe("MCP 出参封装", () => {
  it("json 正常出参不带 isError", () => {
    const r = json({ ok: true });
    expect(r.isError).toBe(false);
    expect(r.content[0].type).toBe("text");
  });

  it("fail 把异常转成人话错误(isError)", () => {
    const r = fail(new Error("草稿尚未验收:请先提交验收再同步公众号"));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("草稿尚未验收");
  });
});

describe("MCP server 装配", () => {
  it("tools/list 暴露的正是注册表里的那批工具", async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ kind: "pat", sub: "test", patId: "1" });
    await server.connect(serverT);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientT);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    await client.close();
    await server.close();
  });
});
