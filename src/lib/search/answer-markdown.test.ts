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
});
