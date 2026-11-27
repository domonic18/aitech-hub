/**
 * AI 智能指数·上游解析与校验闸门单测
 * 验三件事:CSV 解析(表头缺列即拒)、闸门(越界/暴跌/未来日期都拒)、
 * 前沿轨迹(running max)。
 */
import { describe, expect, it } from "vitest";

import {
  computeEciFrontier,
  hashEciModels,
  parseEciCsv,
  validateEciDataset,
  type EciModel,
} from "./epoch-source";

const HEADER =
  "Model,Display name,eci,eci_ci_low,eci_ci_high,date,Organization,Country (of organization),Model accessibility,Accessibility group,model_versions";

function csv(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

function model(over: Partial<EciModel> = {}): EciModel {
  return {
    model: "M",
    displayName: "M",
    eci: 100,
    ciLow: 90,
    ciHigh: 110,
    date: "2026-01-01",
    organization: "Org",
    country: "US",
    accessibility: "API access",
    accessibilityGroup: "Closed weights",
    ...over,
  };
}

/** 造够行数的合法数据集(闸门有最小行数要求) */
function manyModels(n: number, over: Partial<EciModel> = {}): EciModel[] {
  return Array.from({ length: n }, (_, i) =>
    model({
      model: `M${i}`,
      displayName: `M${i}`,
      eci: 100 + i,
      ciLow: 90 + i,
      ciHigh: 110 + i,
      date: "2026-01-01",
      ...over,
    }),
  );
}

describe("parseEciCsv", () => {
  it("解析出模型行", () => {
    const models = parseEciCsv(
      csv([
        "Claude Fable 5.2,Claude Fable 5.2,173.4,170.04,177.22,2026-11-09,Anthropic,USA,API access,Closed weights,",
      ]),
    );
    expect(models).not.toBeNull();
    expect(models?.[0]).toMatchObject({
      model: "Claude Fable 5.2",
      eci: 173.4,
      ciLow: 170.04,
      ciHigh: 177.22,
      date: "2026-11-09",
      organization: "Anthropic",
    });
  });

  it("表头缺必需列返回 null", () => {
    expect(parseEciCsv("Model,eci\nA,1\n")).toBeNull();
  });

  it("日期格式非法的行被丢弃", () => {
    const models = parseEciCsv(csv(["A,A,100,90,110,not-a-date,Org,US,API,Closed,"]));
    expect(models).toEqual([]);
  });
});

describe("computeEciFrontier", () => {
  it("只记录刷新历史最高分的模型", () => {
    const frontier = computeEciFrontier([
      model({ model: "A", displayName: "A", eci: 100, date: "2026-01-01" }),
      model({ model: "B", displayName: "B", eci: 120, date: "2026-02-01" }),
      model({ model: "C", displayName: "C", eci: 110, date: "2026-03-01" }),
    ]);
    expect(frontier.map((f) => f.model)).toEqual(["A", "B"]);
  });
});

describe("hashEciModels", () => {
  it("同内容同哈希(与原文字节无关,换行/空白差异不算变更)", () => {
    const rows = manyModels(60);
    const reformatted = parseEciCsv(
      csv(
        manyModels(60).map((m) =>
          [
            m.model,
            m.displayName,
            m.eci,
            m.ciLow,
            m.ciHigh,
            m.date,
            m.organization,
            m.country,
            m.accessibility,
            m.accessibilityGroup,
            "",
          ].join(","),
        ),
      ),
    );
    expect(reformatted).not.toBeNull();
    expect(hashEciModels(reformatted ?? [])).toBe(hashEciModels(rows));
  });

  it("数据变了哈希就变", () => {
    const a = hashEciModels(manyModels(60));
    const b = hashEciModels(manyModels(60, { eci: 101 }));
    expect(a).not.toBe(b);
  });
});

describe("validateEciDataset", () => {
  const now = new Date("2026-11-27T00:00:00Z");

  it("正常数据通过", () => {
    expect(validateEciDataset(manyModels(60), null, now)).toEqual({ ok: true });
  });

  it("行数低于下限被拒", () => {
    const v = validateEciDataset(manyModels(10), null, now);
    expect(v.ok).toBe(false);
  });

  it("eci 越界被拒", () => {
    const v = validateEciDataset(
      manyModels(60, { eci: 5000, ciLow: 5000, ciHigh: 5000 }),
      null,
      now,
    );
    expect(v.ok).toBe(false);
  });

  it("可信区间不含分值被拒", () => {
    const v = validateEciDataset(manyModels(60, { ciLow: 200, ciHigh: 300 }), null, now);
    expect(v.ok).toBe(false);
  });

  it("未来日期被拒", () => {
    const v = validateEciDataset(manyModels(60, { date: "2027-01-01" }), null, now);
    expect(v.ok).toBe(false);
  });

  it("模型数较上次暴跌被拒", () => {
    const v = validateEciDataset(manyModels(60), { modelCount: 200, frontierEci: 150 }, now);
    expect(v.ok).toBe(false);
  });

  it("前沿 ECI 较上次暴跌被拒", () => {
    const v = validateEciDataset(manyModels(60), { modelCount: 60, frontierEci: 900 }, now);
    expect(v.ok).toBe(false);
  });

  it("前沿大涨不拒(上游真突破不该被误拒)", () => {
    const v = validateEciDataset(manyModels(60), { modelCount: 60, frontierEci: 10 }, now);
    expect(v.ok).toBe(true);
  });
});
