/** 采集计划登记表单测(M34 批③ 验收反馈·问题1):cron 解析 + 登记表不变式。 */
import { describe, expect, it } from "vitest";

import {
  buildScheduleEntries,
  cadenceText,
  parseCron,
  RESIDENT_REGISTRY,
  SCHEDULE_CATEGORIES,
  SCHEDULE_REGISTRY,
} from "./schedules";

describe("parseCron", () => {
  it("单时刻每日:m h * * *", () => {
    expect(parseCron("43 7 * * *")).toEqual({
      times: ["07:43"],
      hourly: false,
      days: null,
      firesPerDay: 1,
    });
  });

  it("通配小时 × 分钟档 = 每小时触发(hourly,日 96 次)", () => {
    expect(parseCron("7,22,37,52 * * * *")).toEqual({
      times: ["00:07", "00:22", "00:37", "00:52"],
      hourly: true,
      days: null,
      firesPerDay: 96,
    });
  });

  it("周频:dow 过滤为触发日(PG 口径 0=周日)", () => {
    expect(parseCron("13 6 * * 1")).toEqual({
      times: ["06:13"],
      hourly: false,
      days: [1],
      firesPerDay: 1,
    });
  });

  it("不支持的形态返回 null(通配分钟/多时刻小时/区间)", () => {
    expect(parseCron("* * * * *")).toBeNull();
    expect(parseCron("0 3,5 * * *")).toBeNull();
    expect(parseCron("3-48 * * * *")).toBeNull();
  });
});

describe("登记表不变式", () => {
  it("key 唯一且分类均已知", () => {
    const keys = SCHEDULE_REGISTRY.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const def of SCHEDULE_REGISTRY) {
      expect(def.category in SCHEDULE_CATEGORIES).toBe(true);
    }
    const residentKeys = RESIDENT_REGISTRY.map((d) => d.key);
    expect(new Set(residentKeys).size).toBe(residentKeys.length);
  });

  it("全部 cron 可解析且为单时刻档(解析失败=登记表与解析器漂移)", () => {
    for (const def of SCHEDULE_REGISTRY) {
      const parsed = parseCron(def.cron);
      expect(parsed, `${def.key}(${def.cron}) 不可解析`).not.toBeNull();
    }
  });

  it("视图分流:低频进日历,>8 次/日进常驻;常驻另有纯 tick 清单", () => {
    const { calendar, resident } = buildScheduleEntries();
    expect(calendar.every((e) => e.parsed.firesPerDay <= 8)).toBe(true);
    // 热榜小时批(24/日,验收二批② 提频)+ 每 15 分钟 ×2(96/日)+ 翻译扫尾
    // 每 10 分钟 ×1(144/日,M58 批①)+ 打标小批每 30 分钟(48/日,M60 批C)分流常驻,
    // 其余留日历
    expect(resident.map((e) => e.key)).toEqual([
      "insight-label",
      "insight-fetch",
      "embed-reconcile",
      "insight-embed",
      "insight-translate",
    ]);
    expect(calendar.map((e) => e.key)).toContain("insight-daily");
    expect(calendar.map((e) => e.key)).toContain("discovery-bili");
    expect(RESIDENT_REGISTRY.length).toBeGreaterThanOrEqual(4);
  });
});

describe("cadenceText", () => {
  it("每日单时刻/周频/高频三种口径", () => {
    const daily = buildScheduleEntries().calendar.find((e) => e.key === "insight-daily")!;
    expect(cadenceText(daily)).toBe("03:57 每日");
    const weekly = buildScheduleEntries().calendar.find((e) => e.key === "discovery-bili")!;
    expect(cadenceText(weekly)).toBe("06:13 周一");
    const hourly = buildScheduleEntries().resident.find((e) => e.key === "insight-embed")!;
    expect(cadenceText(hourly)).toBe("4 次/小时");
  });

  it("热榜小时批(验收二批②):常驻档,人话=1 次/小时", () => {
    const fetch = buildScheduleEntries().resident.find((e) => e.key === "insight-fetch")!;
    expect(cadenceText(fetch)).toBe("1 次/小时");
  });
});

// 分类着色回归:颜色为十六进制(hex-alpha 拼接依赖),改格式须同步视图
describe("SCHEDULE_CATEGORIES", () => {
  it("颜色均为 #rrggbb", () => {
    for (const meta of Object.values(SCHEDULE_CATEGORIES)) {
      expect(meta.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
