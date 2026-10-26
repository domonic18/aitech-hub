import { describe, expect, it } from "vitest";

import {
  asciiSlugFromTitle,
  parsePinSegment,
  pinPath,
  pinPathSegment,
  PIN_PATH_PREFIX,
} from "./pin-path";

describe("pinPathSegment / pinPath", () => {
  it("有 slug 时拼 id-slug 形态", () => {
    expect(pinPathSegment(BigInt(42), "mcp-yi-tu-kan-dong")).toBe("42-mcp-yi-tu-kan-dong");
    expect(pinPath(BigInt(42), "mcp-yi-tu-kan-dong")).toBe("/pins/42-mcp-yi-tu-kan-dong/");
  });

  it("slug 为空时 canonical 为 bare-id 形态", () => {
    expect(pinPathSegment(BigInt(42), null)).toBe("42");
    expect(pinPath(BigInt(42), null)).toBe("/pins/42/");
  });

  it("始终带尾斜杠(trailingSlash 红线,同 postPath)", () => {
    expect(pinPath(BigInt(1), "x").endsWith("/")).toBe(true);
  });

  it("前缀为 /pins", () => {
    expect(PIN_PATH_PREFIX).toBe("/pins");
  });
});

describe("parsePinSegment", () => {
  it("解析 id + 装饰 slug", () => {
    expect(parsePinSegment("42-mcp")).toEqual({ id: BigInt(42), slug: "mcp" });
    expect(parsePinSegment("42")).toEqual({ id: BigInt(42), slug: null });
  });

  it("尾巴不校验(非 canonical 形态解析仍成功于 id,归一交路由层)", () => {
    expect(parsePinSegment("42-随便什么")).toEqual({ id: BigInt(42), slug: "随便什么" });
  });

  it("非 <digits>[-anything] 形态返回 null(调用方 404)", () => {
    expect(parsePinSegment("abc")).toBeNull();
    expect(parsePinSegment("-42")).toBeNull();
    expect(parsePinSegment("")).toBeNull();
  });

  it("超大 id 不丢精度(BigInt 解析)", () => {
    expect(parsePinSegment("9007199254740993")?.id).toBe(BigInt("9007199254740993"));
  });
});

describe("asciiSlugFromTitle(复用 post-path 实现)", () => {
  it("取 ASCII token 连接;纯中文标题返回 null", () => {
    expect(asciiSlugFromTitle("一文看懂 MCP 协议")).toBe("mcp");
    expect(asciiSlugFromTitle("图文看懂 Transformer 注意力")).toBe("transformer");
    expect(asciiSlugFromTitle("一文看懂协议")).toBeNull();
  });
});
