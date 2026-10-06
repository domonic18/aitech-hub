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
});
