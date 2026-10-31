/**
 * 榜单行 → 散点输入适配单测(M63 v2):两节共用几何,但取值口径不同——
 * 模型榜 = 输出价 × 能力分(开源权重空心),HF = 下载量 × 点赞数(标注用模型短名)。
 * 缺字段必须原样传 null(由几何计 missingCount),不得兜底成 0(0 会画出假点)。
 */
import { describe, expect, it } from "vitest";

import type { PublicLeaderboard, PublicLeaderboardRow } from "./public";
import {
  HF_SCATTER_OPTIONS,
  hfScatterData,
  modelScatterData,
  modelScatterOptions,
} from "./scatter-data";

function row(over: Partial<PublicLeaderboardRow> & { entityKey: string }): PublicLeaderboardRow {
  return {
    rank: 1,
    entityName: over.entityKey,
    entityType: "model",
    vendor: null,
    score: null,
    scoreUnit: null,
    url: "",
    extra: {},
    delta: null,
    ...over,
  };
}

function board(rows: PublicLeaderboardRow[]): PublicLeaderboard {
  return {
    key: "k",
    board: "b",
    label: "L",
    sourceUrl: "https://example.com",
    entityType: "model",
    capturedDate: "2026-10-31",
    staleDays: 0,
    hasPrevious: false,
    rows,
  };
}

describe("modelScatterData", () => {
  it("x = 输出价,y = 能力分;开源权重标记空心", () => {
    const data = modelScatterData(
      board([
        row({
          entityKey: "m1",
          entityName: "Model One",
          vendor: "Acme",
          rank: 2,
          score: 61.5,
          extra: { price1mOutputTokens: 2.5, isOpenWeights: true },
        }),
      ]),
    );
    expect(data).toEqual([
      {
        key: "m1",
        name: "Model One",
        vendor: "Acme",
        x: 2.5,
        y: 61.5,
        rank: 2,
        hollow: true,
      },
    ]);
  });

  it("缺价格/缺能力分原样传 null(不兜底为 0)", () => {
    const data = modelScatterData(
      board([
        row({ entityKey: "a", score: 50 }),
        row({ entityKey: "b", extra: { price1mOutputTokens: 1 } }),
      ]),
    );
    expect(data.map((d) => [d.x, d.y])).toEqual([
      [null, 50],
      [1, null],
    ]);
    expect(data.every((d) => d.hollow === false)).toBe(true);
  });

  it("空 entityName 回落 entityKey", () => {
    const data = modelScatterData(board([row({ entityKey: "key-only", entityName: "" })]));
    expect(data[0]!.name).toBe("key-only");
  });

  it("轴配置:对数价格 × 线性能力分,按能力分排序标注", () => {
    const opts = modelScatterOptions();
    expect(opts.x.scale).toBe("log");
    expect(opts.y.scale).toBe("linear");
    expect(opts.labelOrder).toBe("value");
  });

  it("人民币默认刻度,美元另出一套;两者仅差刻度格式", () => {
    expect(modelScatterOptions("cny").x.format(10)).toBe("¥10");
    expect(modelScatterOptions("usd").x.format(10)).toBe("$10");
    // y 轴(能力分)与币种无关:同尺度、同文本
    expect(modelScatterOptions("usd").y.scale).toBe(modelScatterOptions("cny").y.scale);
    expect(modelScatterOptions("usd").y.format(61.53)).toBe(
      modelScatterOptions("cny").y.format(61.53),
    );
  });

  it("汇率只放大 x(价格),y(能力分)与原价保持不折算", () => {
    const data = modelScatterData(
      board([row({ entityKey: "m1", score: 61.5, extra: { price1mOutputTokens: 2 } })]),
      7.2,
    );
    expect(data[0]!.x).toBeCloseTo(14.4, 6);
    expect(data[0]!.y).toBe(61.5);
  });

  it("无价格仍传 null(折算了也不能兜底成 0)", () => {
    const data = modelScatterData(board([row({ entityKey: "m1", score: 61.5 })]), 7.2);
    expect(data[0]!.x).toBeNull();
  });
});

describe("hfScatterData", () => {
  it("x = 下载量,y = 点赞数;组织取 vendor,标注用模型短名", () => {
    const data = hfScatterData(
      board([
        row({
          entityKey: "Qwen/Qwen3-8B",
          entityName: "Qwen/Qwen3-8B",
          vendor: "Qwen",
          score: 1234.5,
          extra: { downloads: 1_200_000, likes: 4200, pipelineTag: "text-generation" },
        }),
      ]),
    );
    expect(data).toEqual([
      {
        key: "Qwen/Qwen3-8B",
        name: "Qwen3-8B",
        vendor: "Qwen",
        x: 1_200_000,
        y: 4200,
        rank: 1,
      },
    ]);
  });

  it("无组织前缀的 id 原样作名;缺下载/点赞原样传 null", () => {
    const data = hfScatterData(
      board([
        row({ entityKey: "bert", extra: { downloads: 10 } }),
        row({ entityKey: "org/m", extra: { likes: 3 } }),
      ]),
    );
    expect(data[0]!.name).toBe("bert");
    expect([data[0]!.x, data[0]!.y]).toEqual([10, null]);
    expect([data[1]!.x, data[1]!.y]).toEqual([null, 3]);
  });

  it("轴配置:双对数,按趋势榜名次排序标注", () => {
    expect(HF_SCATTER_OPTIONS.x.scale).toBe("log");
    expect(HF_SCATTER_OPTIONS.y.scale).toBe("log");
    expect(HF_SCATTER_OPTIONS.labelOrder).toBe("rank");
  });
});
