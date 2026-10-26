/** F21/F22 计划页纯推导:cron/间隔未来 3 次、下次执行与最近运行文案、日历条目 */
import { describe, expect, it } from "vitest";

import { formatCnDate, formatCnTime } from "../datetime";
import { parseCron } from "./schedules";
import {
  cadenceLabel,
  cronCal,
  formatLastRun,
  formatNextRuns,
  intervalCal,
  nextCronRuns,
  nextIntervalRuns,
} from "./plan-rows-types";

const FROM = new Date("2026-10-23T12:00:00+08:00"); // 周五 12:00(北京)

describe("nextCronRuns", () => {
  it("每日 05:37:当日已过 → 明日起连 3 天", () => {
    const runs = nextCronRuns(parseCron("37 5 * * *")!, 3, FROM);
    expect(runs.map((r) => formatCnTime(r))).toEqual(["05:37", "05:37", "05:37"]);
    expect(runs.map((r) => formatCnDate(r))).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  });

  it("周一档:跳过非周一(周五起 → 下下两个周一)", () => {
    const runs = nextCronRuns(parseCron("13 6 * * 1")!, 2, FROM);
    expect(runs.map((r) => formatCnDate(r))).toEqual(["2026-10-26", "2026-11-02"]);
  });

  it("每小时档:首个未来整点 :43,逐小时连续", () => {
    const runs = nextCronRuns(parseCron("43 * * * *")!, 3, FROM);
    expect(runs.map((r) => formatCnTime(r))).toEqual(["12:43", "13:43", "14:43"]);
    expect(runs.map((r) => formatCnDate(r))).toEqual(["2026-10-23", "2026-10-23", "2026-10-23"]);
  });

  it("多时刻日档:今日档已过后从明日起(今日档计入已由每小时档覆盖)", () => {
    const runs = nextCronRuns(parseCron("30,45 9 * * *")!, 3, FROM);
    expect(runs.map((r) => `${formatCnDate(r)} ${formatCnTime(r)}`)).toEqual([
      "2026-10-24 09:30",
      "2026-10-24 09:45",
      "2026-10-25 09:30",
    ]);
  });
});

describe("nextIntervalRuns", () => {
  it("nextRunAt 落后现刻 → 先追平再步进", () => {
    const stale = new Date("2026-10-23T10:50:00+08:00");
    const runs = nextIntervalRuns(stale, 30, 3, FROM);
    expect(runs.map((r) => formatCnTime(r))).toEqual(["12:20", "12:50", "13:20"]);
  });

  it("null → 空(不可推)", () => {
    expect(nextIntervalRuns(null, 30, 3, FROM)).toEqual([]);
  });
});

describe("formatNextRuns", () => {
  it("板例「今天 14:30 · 15:00 · 15:30」:同日续条只补时刻", () => {
    const seq = [
      new Date("2026-10-23T14:30:00+08:00"),
      new Date("2026-10-23T15:00:00+08:00"),
      new Date("2026-10-23T15:30:00+08:00"),
    ];
    expect(formatNextRuns(seq, FROM)).toBe("今天 14:30 · 15:00 · 15:30");
  });

  it("跨日带前缀,空 → —", () => {
    const seq = [new Date("2026-10-24T09:30:00+08:00"), new Date("2026-10-24T21:30:00+08:00")];
    expect(formatNextRuns(seq, FROM)).toBe("明天 09:30 · 21:30");
    expect(formatNextRuns([], FROM)).toBe("—");
  });
});

describe("formatLastRun", () => {
  it("运行中秒表(板「运行中 · 已 2m 31s」)", () => {
    expect(formatLastRun(null, true, FROM.getTime() - 151_000, FROM)).toBe("运行中 · 已 2m 31s");
  });

  it("1 小时内相对分钟 + 成败后缀", () => {
    expect(formatLastRun(new Date(FROM.getTime() - 2 * 60_000), true, null, FROM)).toBe(
      "2 分钟前 · 成功",
    );
    expect(formatLastRun(new Date(FROM.getTime() - 3 * 3_600_000), false, null, FROM)).toBe(
      "今天 09:00 · 失败",
    );
  });

  it("昨日与空值", () => {
    expect(formatLastRun(new Date("2026-10-22T21:30:00+08:00"), true, null, FROM)).toBe(
      "昨天 21:30 · 成功",
    );
    expect(formatLastRun(null, true, null, FROM)).toBeNull();
  });
});

describe("cadenceLabel", () => {
  it("板口径:每小时 :43 / 每日 / 周一 / 每 15 分钟", () => {
    expect(cadenceLabel(parseCron("43 * * * *")!)).toBe("每小时 :43");
    expect(cadenceLabel(parseCron("37 5 * * *")!)).toBe("每日 05:37");
    expect(cadenceLabel(parseCron("13 6 * * 1")!)).toBe("周一 06:13");
    expect(cadenceLabel(parseCron("3,18,33,48 * * * *")!)).toBe("每 15 分钟");
  });
});

describe("cronCal / intervalCal", () => {
  it("窗外任务 → weekHour null(footnote);hourly 循环型代表档 = 8", () => {
    const out = cronCal({
      key: "a",
      group: "discovery",
      label: "热词发现",
      parsed: parseCron("37 5 * * *")!,
      enabled: true,
    });
    expect(out.weekHour).toBeNull();
    expect(out.times).toEqual(["05:37"]);
    const hourly = cronCal({
      key: "b",
      group: "hot",
      label: "百度热搜",
      parsed: parseCron("43 * * * *")!,
      enabled: true,
    });
    expect(hourly.weekHour).toBe(8);
    expect(hourly.times).toBeNull(); // 循环型不展开 24 档
  });

  it("多时刻日内档:weekHour 取窗内首档,times 保留全部(分钟列表×单小时形态)", () => {
    const e = cronCal({
      key: "c",
      group: "social",
      label: "B站UP主",
      parsed: parseCron("30,45 9 * * *")!,
      enabled: true,
    });
    expect(e.weekHour).toBe(9);
    expect(e.times).toEqual(["09:30", "09:45"]);
  });

  it("间隔行:相位推进找窗内代表档;停用 → null", () => {
    const e = intervalCal({
      key: "d",
      group: "rss",
      label: "量子位RSS",
      intervalMin: 30,
      nextRunAt: new Date("2026-10-23T05:10:00+08:00"),
      enabled: true,
      from: new Date("2026-10-23T06:00:00+08:00"),
    });
    expect(e.weekHour).toBe(8);
    expect(e.firesPerDay).toBe(48);
    expect(e.times).toBeNull();
    const off = intervalCal({
      key: "e",
      group: "rss",
      label: "停用渠道",
      intervalMin: 30,
      nextRunAt: null,
      enabled: false,
    });
    expect(off.weekHour).toBeNull();
  });
});
