/**
 * frontmatter 手写 YAML 子集单测:围栏/无围栏/引号/tags 两式/畸形输入。
 */
import { describe, expect, it } from "vitest";

import { fmString, fmStringArray, parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("标准围栏:键值 + 正文剥离", () => {
    const { fm, body } = parseFrontmatter(
      "---\ntitle: Hello World\nslug: hello-world\n---\n\n正文第一段\n",
    );
    expect(fm.title).toBe("Hello World");
    expect(fm.slug).toBe("hello-world");
    expect(body).toBe("\n正文第一段\n");
  });

  it("无围栏 → 空 fm,原文即正文;仅开围栏无闭合同判", () => {
    expect(parseFrontmatter("纯正文")).toEqual({ fm: {}, body: "纯正文" });
    const unclosed = parseFrontmatter("---\ntitle: x\n没有闭合");
    expect(unclosed.fm).toEqual({});
    expect(unclosed.body).toBe("---\ntitle: x\n没有闭合");
  });

  it("引号剥离(单双引号),值内空串归 undefined 由 fmString 处理", () => {
    const { fm } = parseFrontmatter("---\ntitle: \"带 引号 的标题\"\nseoTitle: '单引号'\n---\nB");
    expect(fm.title).toBe("带 引号 的标题");
    expect(fm.seoTitle).toBe("单引号");
  });

  it("tags 行内数组与多行列表两式等价;裸串按中英逗号切分", () => {
    const inline = parseFrontmatter("---\ntags: [ai, tool, dev]\n---\nB");
    const block = parseFrontmatter("---\ntags:\n  - ai\n  - tool\n  - dev\n---\nB");
    const bare = parseFrontmatter("---\ntags: ai, tool, dev\n---\nB");
    expect(inline.fm.tags).toEqual(["ai", "tool", "dev"]);
    expect(block.fm.tags).toEqual(["ai", "tool", "dev"]);
    expect(fmStringArray(bare.fm, "tags")).toEqual(["ai", "tool", "dev"]);
  });

  it("畸形行忽略;CRLF 兼容;围栏后无换行(文件末尾直 ---)", () => {
    const messy = parseFrontmatter("---\r\n这不是键值行\r\ntitle: T\r\n!!!\r\n---\r\nBODY");
    expect(messy.fm.title).toBe("T");
    expect(messy.body).toBe("BODY");
    expect(parseFrontmatter("---\ntitle: T\n---").body).toBe("");
  });
});

describe("fmString / fmStringArray", () => {
  it("数组取 fmString → undefined;空串/缺失 → undefined", () => {
    expect(fmString({ title: "  " }, "title")).toBeUndefined();
    expect(fmString({ tags: ["a"] }, "tags")).toBeUndefined();
    expect(fmString({}, "title")).toBeUndefined();
    expect(fmString({ title: " x " }, "title")).toBe("x");
    expect(fmStringArray({}, "tags")).toBeUndefined();
  });
});
