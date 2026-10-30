/** 运行页摘要格式化单测(2026-10-30 E2E:采集台账行原先只显示原始 JSON) */
import { describe, expect, it } from "vitest";

import { crawlCount, crawlSummaryLine } from "./run-format";

describe("crawlCount", () => {
  it("registry 渠道入库恒 0 → 退抓取数", () => {
    expect(crawlCount({ fetched: 6, inserted: 0 })).toBe(6);
  });

  it("有真实入库则用入库数", () => {
    expect(crawlCount({ fetched: 10, inserted: 3 })).toBe(3);
  });

  it("缺 fetched 时保留 inserted(空跑显示 0,不吞计数)", () => {
    expect(crawlCount({ inserted: 0 })).toBe(0);
    expect(crawlCount({})).toBeNull();
    expect(crawlCount(null)).toBeNull();
  });
});

describe("crawlSummaryLine", () => {
  it("渠道名 + 抓取量", () => {
    expect(crawlSummaryLine({ sourceName: "vendor:anthropic", fetched: 6 })).toBe(
      "vendor:anthropic · 抓取 6",
    );
  });

  it("去重/主题外/超日上限按需追加", () => {
    expect(
      crawlSummaryLine({
        sourceName: "量子位",
        fetched: 10,
        inserted: 0,
        duplicated: 10,
        topicSkipped: 2,
        skippedDailyCap: true,
      }),
    ).toBe("量子位 · 抓取 10 · 去重 10 · 主题外 2 · 超日上限顺延");
  });

  it("无渠道名(旧记录)返回 null 走通用 JSON 截头", () => {
    expect(crawlSummaryLine({ fetched: 3, inserted: 0 })).toBeNull();
    expect(crawlSummaryLine(null)).toBeNull();
  });
});
