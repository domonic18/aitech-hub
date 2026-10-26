/**
 * 聚合纯函数单测:跨词去重合并、样本标题上限与去重、双排序稳定性。
 */
import { describe, expect, it } from "vitest";

import { aggregateBloggers, aggregateVideos, type WordResult } from "./aggregate";

function w(word: string, items: WordResult["items"]): WordResult {
  return { word, items };
}

describe("aggregateBloggers", () => {
  it("跨词合并同一 mid:hitKeywords 去重、hitCount 同步、maxPlay 取最大", () => {
    const [agg, ...rest] = aggregateBloggers([
      w("cursor", [{ bvid: "BV1", mid: 100, author: "阿明", title: "Cursor 实战", play: 60_000 }]),
      w("claude", [
        { bvid: "BV2", mid: 100, author: "阿明", title: "Claude 指南", play: 90_000 },
        { bvid: "BV3", mid: 200, author: "小张", title: "别的不相关", play: 10 },
      ]),
    ]);
    expect(rest).toHaveLength(1);
    expect(agg).toMatchObject({
      mid: "100",
      author: "阿明",
      hitKeywords: ["cursor", "claude"],
      hitCount: 2,
      maxPlay: 90_000,
    });
  });

  it("样本标题去重且封顶 5 条", () => {
    const agg = aggregateBloggers([
      w("ai", [
        { bvid: "BV1", mid: 1, author: "x", title: "t1", play: 1 },
        { bvid: "BV2", mid: 1, author: "x", title: "t1", play: 1 },
        { bvid: "BV3", mid: 1, author: "x", title: "t2", play: 1 },
        { bvid: "BV4", mid: 1, author: "x", title: "t3", play: 1 },
        { bvid: "BV5", mid: 1, author: "x", title: "t4", play: 1 },
        { bvid: "BV6", mid: 1, author: "x", title: "t5", play: 1 },
        { bvid: "BV7", mid: 1, author: "x", title: "t6", play: 1 },
      ]),
    ])[0];
    expect(agg.sampleTitles).toEqual(["t1", "t2", "t3", "t4", "t5"]);
  });

  it("双排序:hitCount desc → maxPlay desc → mid 序", () => {
    const sorted = aggregateBloggers([
      w("a", [{ bvid: "BV1", mid: 2, author: "b", title: "x", play: 100 }]),
      w("a", [{ bvid: "BV2", mid: 1, author: "a", title: "x", play: 100 }]),
      w("a", [{ bvid: "BV3", mid: 3, author: "c", title: "x", play: 500 }]),
      w("a", [{ bvid: "BV4", mid: 4, author: "d", title: "x", play: 50 }]),
    ]);
    expect(sorted.map((s) => s.mid)).toEqual(["3", "1", "2", "4"]);
  });

  it("空输入返回空数组", () => {
    expect(aggregateBloggers([])).toEqual([]);
  });
});

describe("aggregateVideos", () => {
  it("跨词合并同一 bvid,play 取最大,排序 hitCount → play", () => {
    const sorted = aggregateVideos([
      w("k1", [{ bvid: "BVa", mid: 1, author: "甲", title: "v1", play: 80_000 }]),
      w("k2", [
        { bvid: "BVa", mid: 1, author: "甲", title: "v1", play: 90_000 },
        { bvid: "BVb", mid: 2, author: "乙", title: "v2", play: 500_000 },
      ]),
    ]);
    expect(sorted).toHaveLength(2);
    expect(sorted[0]).toMatchObject({
      bvid: "BVa",
      hitKeywords: ["k1", "k2"],
      hitCount: 2,
      play: 90_000,
    });
    expect(sorted[1]).toMatchObject({ bvid: "BVb", hitCount: 1, play: 500_000 });
  });

  it("空输入返回空数组", () => {
    expect(aggregateVideos([])).toEqual([]);
  });
});
