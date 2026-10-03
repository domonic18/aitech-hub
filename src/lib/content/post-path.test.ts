import { describe, expect, it } from "vitest";

import {
  asciiSlugCandidates,
  asciiSlugFromTitle,
  isAsciiSlug,
  parsePostSegment,
  postPath,
  postPathSegment,
} from "./post-path";

describe("postPath/postPathSegment(/post/<id>-<slug> 唯一构造点)", () => {
  it("slug 非空 → <id>-<slug>,带尾斜杠", () => {
    expect(postPath(BigInt(156), "agent-ceping")).toBe("/post/156-agent-ceping/");
    expect(postPathSegment(BigInt(156), "agent-ceping")).toBe("156-agent-ceping");
  });

  it("slug 空 → bare-id 形态", () => {
    expect(postPath(BigInt(58), null)).toBe("/post/58/");
    expect(postPathSegment(BigInt(58), null)).toBe("58");
  });
});

describe("parsePostSegment(只认 id,尾巴宽容)", () => {
  it("canonical 段解析出 id 与 slug", () => {
    expect(parsePostSegment("156-agent-ceping")).toEqual({ id: BigInt(156), slug: "agent-ceping" });
    expect(parsePostSegment("58")).toEqual({ id: BigInt(58), slug: null });
  });

  it("非 canonical 尾巴也命中 id(容错,归一交给路由层 308)", () => {
    expect(parsePostSegment("156-任意乱写")).toEqual({ id: BigInt(156), slug: "任意乱写" });
    expect(parsePostSegment("156-agent-ceping-extra")).toEqual({
      id: BigInt(156),
      slug: "agent-ceping-extra",
    });
  });

  it("畸形 → null(空/非数字起头/前缀垃圾)", () => {
    expect(parsePostSegment("")).toBeNull();
    expect(parsePostSegment("abc")).toBeNull();
    expect(parsePostSegment("abc-156")).toBeNull();
    expect(parsePostSegment("-156")).toBeNull();
    expect(parsePostSegment("15 6")).toBeNull();
  });
});

describe("asciiSlugFromTitle(标题派生,新建/迁移共用)", () => {
  it("ASCII token 依序连接并小写化", () => {
    expect(asciiSlugFromTitle("【工具技巧】Claude Code+K2模型编写Dify插件")).toBe(
      "claude-code-k2-dify",
    );
    expect(asciiSlugFromTitle("【课程总结】Day2：KNN算法")).toBe("day2-knn");
    expect(asciiSlugFromTitle("本地通过open-webui+ollama部署大模型")).toBe("open-webui-ollama");
  });

  it("连续重复 token 去重", () => {
    expect(asciiSlugFromTitle("MCP协议之MCP简述")).toBe("mcp");
  });

  it("纯中文标题 → null(bare-id)", () => {
    expect(asciiSlugFromTitle("【重拾数学知识】向量、内积、余弦定理")).toBeNull();
  });

  it("超长在 token 边界截断(≤80,不截半 token)", () => {
    const slug = asciiSlugFromTitle(
      "aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee ffffffffff gggggggggg hhhhhhhhhh",
    );
    // 7 token 全收 = 70 + 6 连字符 = 76;第 8 个 token 会到 87 > 80 → 在边界截断
    expect(slug).toBe(
      "aaaaaaaaaa-bbbbbbbbbb-cccccccccc-dddddddddd-eeeeeeeeee-ffffffffff-gggggggggg",
    );
    expect(slug!.length).toBe(76);
  });
});

describe("asciiSlugCandidates(派生冲突后缀与写侧策略一致)", () => {
  it("base 优先,后缀 -2…-9", () => {
    expect(asciiSlugCandidates("day8")).toEqual([
      "day8",
      "day8-2",
      "day8-3",
      "day8-4",
      "day8-5",
      "day8-6",
      "day8-7",
      "day8-8",
      "day8-9",
    ]);
  });
});

describe("isAsciiSlug", () => {
  it("接受规范形态,拒绝空/首尾连字符/大写/下划线", () => {
    expect(isAsciiSlug("day2-knn")).toBe(true);
    expect(isAsciiSlug("a")).toBe(true);
    expect(isAsciiSlug("")).toBe(false);
    expect(isAsciiSlug("-a-")).toBe(false);
    expect(isAsciiSlug("A-b")).toBe(false);
    expect(isAsciiSlug("a_b")).toBe(false);
    expect(isAsciiSlug("a--b")).toBe(false);
  });
});
