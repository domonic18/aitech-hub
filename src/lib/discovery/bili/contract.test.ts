/**
 * B站契约解析单测:em 高亮清洗、envelope 风控/业务码分流、列表逐条容错、
 * card 形态校验(形态以原型实证为准)。
 */
import { describe, expect, it } from "vitest";

import { expectEnvelopeOk, parseCard, parseSearchPage, stripBiliTags } from "./contract";
import { BiliApiUpstreamError, BiliRiskControlError } from "./errors";

describe("stripBiliTags", () => {
  it("剥掉搜索高亮 em 标签并去首尾空白", () => {
    expect(stripBiliTags('<em class="keyword">cursor</em> 教程 ')).toBe("cursor 教程");
  });
  it("无标签原样返回", () => {
    expect(stripBiliTags("普通标题")).toBe("普通标题");
  });
});

describe("expectEnvelopeOk", () => {
  it("code=0 放行", () => {
    expect(() => expectEnvelopeOk({ code: 0, message: "0" })).not.toThrow();
  });
  it("业务码 -412/-352 抛风控(退避重试语义)", () => {
    expect(() => expectEnvelopeOk({ code: -412, message: "请求过频" })).toThrow(
      BiliRiskControlError,
    );
    expect(() => expectEnvelopeOk({ code: -352 })).toThrow(BiliRiskControlError);
  });
  it("其余非零业务码抛 Upstream", () => {
    expect(() => expectEnvelopeOk({ code: -403, message: "权限不足" })).toThrow(
      BiliApiUpstreamError,
    );
  });
  it("envelope 形态不符抛 Upstream", () => {
    expect(() => expectEnvelopeOk({ html: "<html/>" })).toThrow(BiliApiUpstreamError);
    expect(() => expectEnvelopeOk(null)).toThrow(BiliApiUpstreamError);
  });
});

describe("parseSearchPage", () => {
  it("解析条目并清洗 title/author 高亮", () => {
    const { items, dropped } = parseSearchPage({
      data: {
        result: [
          {
            bvid: "BV1xx",
            mid: 42,
            author: "<em class='keyword'>AI</em>实验室",
            title: "<em class='keyword'>Cursor</em> 入门",
            play: 123456,
          },
        ],
      },
    });
    expect(dropped).toBe(0);
    expect(items).toEqual([
      { bvid: "BV1xx", mid: 42, author: "AI实验室", title: "Cursor 入门", play: 123456 },
    ]);
  });

  it("坏条目丢弃计数不弃整页", () => {
    const { items, dropped } = parseSearchPage({
      data: {
        result: [
          { bvid: "BVok", mid: 1, author: "a", title: "t", play: 1 },
          { bvid: "", mid: 2, author: "a", title: "缺 bvid", play: 1 },
          { author: "缺 bvid 整条", title: "t", play: 1 },
          "not-an-object",
        ],
      },
    });
    expect(items).toHaveLength(1);
    expect(dropped).toBe(3);
  });

  it("result 缺省按空页处理", () => {
    const { items, dropped } = parseSearchPage({ data: {} });
    expect(items).toEqual([]);
    expect(dropped).toBe(0);
  });
});

describe("parseCard", () => {
  it("解析 name/fans/archive_count 并清洗名称", () => {
    const card = parseCard({
      data: { card: { name: "<em class='keyword'>老王</em>", fans: "12000", archive_count: 88 } },
    });
    expect(card).toEqual({ name: "老王", fans: 12_000, archives: 88 });
  });

  it("缺 card 字段抛 Upstream(风控漏判/形态漂移的显式信号)", () => {
    expect(() => parseCard({ data: {} })).toThrow(BiliApiUpstreamError);
  });
});
