import { describe, expect, it } from "vitest";

import { parseAnswerBlocks, parseAnswerInline } from "./answer-markdown";

describe("parseAnswerInline", () => {
  it("加粗与行内代码各自成段,文本段拼接", () => {
    expect(parseAnswerInline("a **加粗** b `code` c")).toEqual([
      { t: "text", v: "a " },
      { t: "bold", v: "加粗" },
      { t: "text", v: " b " },
      { t: "code", v: "code" },
      { t: "text", v: " c" },
    ]);
  });

  it("未闭合/空内容标记按字面量", () => {
    expect(parseAnswerInline("尾随 **加粗")).toEqual([{ t: "text", v: "尾随 **加粗" }]);
    expect(parseAnswerInline("空 ** 内容")).toEqual([{ t: "text", v: "空 ** 内容" }]);
  });

  it("代码段内不再解析加粗", () => {
    expect(parseAnswerInline("`a **b** c`")).toEqual([{ t: "code", v: "a **b** c" }]);
  });

  it("链接 [文本](URL) 成 link 段;href 首尾空白可容错", () => {
    expect(parseAnswerInline("见 [MCP 教程](https://a.com/post/1) 与 `x`")).toEqual([
      { t: "text", v: "见 " },
      { t: "link", v: "MCP 教程", href: "https://a.com/post/1" },
      { t: "text", v: " 与 " },
      { t: "code", v: "x" },
    ]);
    expect(parseAnswerInline("[t]( https://a.com )")).toEqual([
      { t: "link", v: "t", href: "https://a.com" },
    ]);
  });

  it("链接退化:URL 含内部空白/空 label/未闭合按字面量;跨行 href trim 后恢复", () => {
    expect(parseAnswerInline("[a]( https://a.com b)")).toEqual([
      { t: "text", v: "[a]( https://a.com b)" },
    ]);
    // 模型偶发把 URL 排版到下一行:trim 后无空白 → 恢复为链接
    expect(parseAnswerInline("[a](\nhttps://a.com)")).toEqual([
      { t: "link", v: "a", href: "https://a.com" },
    ]);
    expect(parseAnswerInline("[](https://a.com)")).toEqual([{ t: "text", v: "[](https://a.com)" }]);
    expect(parseAnswerInline("[a](https://a.com")).toEqual([{ t: "text", v: "[a](https://a.com" }]);
  });
});

describe("parseAnswerBlocks", () => {
  it("空行分段;段内软换行拼接;列表项行内解析", () => {
    const blocks = parseAnswerBlocks(
      "首段第一行\n续行。\n\n- **法律金融**:要点一\n- 要点二\n\n尾段",
    );
    expect(blocks).toEqual([
      { kind: "p", segs: [{ t: "text", v: "首段第一行续行。" }] },
      {
        kind: "ul",
        items: [
          [
            { t: "bold", v: "法律金融" },
            { t: "text", v: ":要点一" },
          ],
          [{ t: "text", v: "要点二" }],
        ],
      },
      { kind: "p", segs: [{ t: "text", v: "尾段" }] },
    ]);
  });

  it("有序列表(1./1))成 ol;星号列表符归 ul;列表后接段落", () => {
    const blocks = parseAnswerBlocks("1. 第一\n2) 第二\n* 星号项\n\n后文 `x`");
    expect(blocks).toEqual([
      {
        kind: "ol",
        items: [[{ t: "text", v: "第一" }], [{ t: "text", v: "第二" }]],
      },
      { kind: "ul", items: [[{ t: "text", v: "星号项" }]] },
      {
        kind: "p",
        segs: [
          { t: "text", v: "后文 " },
          { t: "code", v: "x" },
        ],
      },
    ]);
  });

  it("纯单段文本(无标记)退化为一个 p;空文本出空数组", () => {
    expect(parseAnswerBlocks("只有一句话")).toEqual([
      { kind: "p", segs: [{ t: "text", v: "只有一句话" }] },
    ]);
    expect(parseAnswerBlocks("")).toEqual([]);
  });

  it("标题行成 h 块(#~#### 收敛 2~4 级),标题内行内解析,段落被切断", () => {
    const blocks = parseAnswerBlocks("引言\n## 架构 **总览**\n正文\n#### 细节\n# 大标题\n尾段");
    expect(blocks).toEqual([
      { kind: "p", segs: [{ t: "text", v: "引言" }] },
      {
        kind: "h",
        level: 2,
        segs: [
          { t: "text", v: "架构 " },
          { t: "bold", v: "总览" },
        ],
      },
      { kind: "p", segs: [{ t: "text", v: "正文" }] },
      { kind: "h", level: 4, segs: [{ t: "text", v: "细节" }] },
      { kind: "h", level: 2, segs: [{ t: "text", v: "大标题" }] },
      { kind: "p", segs: [{ t: "text", v: "尾段" }] },
    ]);
  });

  it("围栏代码原文收集(不做行内解析),语言标记剥离", () => {
    const blocks = parseAnswerBlocks('前文\n```ts\nconst a = "**x**";\n`y`\n```\n后文');
    expect(blocks).toEqual([
      { kind: "p", segs: [{ t: "text", v: "前文" }] },
      { kind: "pre", lang: "ts", v: 'const a = "**x**";\n`y`' },
      { kind: "p", segs: [{ t: "text", v: "后文" }] },
    ]);
  });

  it("未闭合围栏到 EOF 按代码块收尾;无语言标记为空串", () => {
    const blocks = parseAnswerBlocks("```\nline1\n\nline2");
    expect(blocks).toEqual([{ kind: "pre", lang: "", v: "line1\n\nline2" }]);
  });

  it("围栏内 #- 行与空行不触发块解析", () => {
    const blocks = parseAnswerBlocks("```md\n## 不是标题\n- 不是列表\n```");
    expect(blocks).toEqual([{ kind: "pre", lang: "md", v: "## 不是标题\n- 不是列表" }]);
  });

  it("表头+分隔行开表格,表体连续含 | 行,单元格做行内解析", () => {
    const blocks = parseAnswerBlocks(
      "| 维度 | FC |\n|------|----|\n| **定位** | 模型能力 |\n| 范围 | 单次调用 |\n\n表后段",
    );
    expect(blocks).toEqual([
      {
        kind: "table",
        head: [[{ t: "text", v: "维度" }], [{ t: "text", v: "FC" }]],
        rows: [
          [[{ t: "bold", v: "定位" }], [{ t: "text", v: "模型能力" }]],
          [[{ t: "text", v: "范围" }], [{ t: "text", v: "单次调用" }]],
        ],
      },
      { kind: "p", segs: [{ t: "text", v: "表后段" }] },
    ]);
  });

  it("对齐分隔行(:---:)也识别;含 | 但下一行非分隔行不成表", () => {
    const aligned = parseAnswerBlocks("| a | b |\n| :--- | ---: |\n| 1 | 2 |");
    expect(aligned).toEqual([
      {
        kind: "table",
        head: [[{ t: "text", v: "a" }], [{ t: "text", v: "b" }]],
        rows: [[[{ t: "text", v: "1" }], [{ t: "text", v: "2" }]]],
      },
    ]);
    expect(parseAnswerBlocks("| a | b |\n普通段落行")).toEqual([
      { kind: "p", segs: [{ t: "text", v: "| a | b |普通段落行" }] },
    ]);
  });

  it("列表项内链接成 link 段(清单场景)", () => {
    const blocks = parseAnswerBlocks("- [MCP 教程](https://a.com/p/1):用 FastMCP");
    expect(blocks).toEqual([
      {
        kind: "ul",
        items: [
          [
            { t: "link", v: "MCP 教程", href: "https://a.com/p/1" },
            { t: "text", v: ":用 FastMCP" },
          ],
        ],
      },
    ]);
  });
});
