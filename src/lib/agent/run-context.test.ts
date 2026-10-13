/**
 * run 页面上下文单测(M27 批⑧-b):路由→page 映射(尾斜杠归一/未命中回落)/
 * 宽松解析(坏形状返 null 不抛)/ 身份 sanitize(非 admin 剥 edit 段)/
 * 前缀注入(null 原样、有值 [页面上下文] 单行 JSON + 空行接原消息)。
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_CONTEXT_PREFIX,
  buildAgentPageContext,
  parseAgentRunContext,
  sanitizeAgentRunContext,
  withAgentContext,
} from "./run-context";

describe("buildAgentPageContext", () => {
  it("路由→页面名映射(编辑/新建/管理/专题/其他后台/搜索/电报/项目/首页)", () => {
    expect(buildAgentPageContext("/admin/posts/123")).toBe("文章编辑");
    expect(buildAgentPageContext("/admin/posts/new")).toBe("文章新建");
    expect(buildAgentPageContext("/admin/posts")).toBe("文章管理");
    expect(buildAgentPageContext("/admin/topics")).toBe("专题治理");
    expect(buildAgentPageContext("/admin/feedback")).toBe("后台");
    expect(buildAgentPageContext("/search")).toBe("搜索");
    expect(buildAgentPageContext("/telegram")).toBe("电报流");
    expect(buildAgentPageContext("/projects")).toBe("开源项目");
    expect(buildAgentPageContext("/")).toBe("首页");
  });

  it("尾斜杠归一;未命中路由回落「前台」(page 恒在场)", () => {
    expect(buildAgentPageContext("/search/")).toBe("搜索");
    expect(buildAgentPageContext("/post/123-abc")).toBe("前台");
  });
});

describe("parseAgentRunContext", () => {
  it("合法形状透传(edit 可省)", () => {
    expect(
      parseAgentRunContext({ page: "文章编辑", edit: { postId: "123", title: "标题" } }),
    ).toEqual({ page: "文章编辑", edit: { postId: "123", title: "标题" } });
    expect(parseAgentRunContext({ page: "搜索" })).toEqual({ page: "搜索" });
  });

  it("坏形状一律 null(宽松:聊天不因坏上下文挂掉)", () => {
    expect(parseAgentRunContext(null)).toBeNull();
    expect(parseAgentRunContext(undefined)).toBeNull();
    expect(parseAgentRunContext("junk")).toBeNull();
    expect(parseAgentRunContext({})).toBeNull();
    expect(parseAgentRunContext({ page: "" })).toBeNull();
    expect(parseAgentRunContext({ page: "x".repeat(65) })).toBeNull();
    expect(parseAgentRunContext({ page: "x", edit: { postId: "bad id", title: "t" } })).toBeNull();
    expect(
      parseAgentRunContext({ page: "x", edit: { postId: "1", title: "t".repeat(301) } }),
    ).toBeNull();
  });
});

describe("sanitizeAgentRunContext", () => {
  const ctx = { page: "文章编辑", edit: { postId: "123", title: "标题" } };

  it("admin 保留 edit;user/guest 剥 edit 留 page(fail-safe)", () => {
    expect(sanitizeAgentRunContext(ctx, "admin")).toEqual(ctx);
    expect(sanitizeAgentRunContext(ctx, "user")).toEqual({ page: "文章编辑" });
    expect(sanitizeAgentRunContext(ctx, "guest")).toEqual({ page: "文章编辑" });
  });

  it("null 进 null 出;无 edit 段各身份原样", () => {
    expect(sanitizeAgentRunContext(null, "admin")).toBeNull();
    expect(sanitizeAgentRunContext({ page: "搜索" }, "guest")).toEqual({ page: "搜索" });
  });
});

describe("withAgentContext", () => {
  it("null 原样返回(无上下文不改写消息)", () => {
    expect(withAgentContext("你好", null)).toBe("你好");
  });

  it("有值加 [页面上下文] 前缀 + 单行 JSON + 空行接原消息(ai-invest 同款)", () => {
    const out = withAgentContext("你好", {
      page: "文章编辑",
      edit: { postId: "123", title: "标题" },
    });
    expect(out.startsWith(`${AGENT_CONTEXT_PREFIX} `)).toBe(true);
    expect(out).toContain('"postId":"123"');
    expect(out.endsWith("\n\n你好")).toBe(true);
  });
});
