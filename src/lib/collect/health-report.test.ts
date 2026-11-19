/**
 * 运营巡查健康度判定单测(M75 运维面):problems 判定口径 + 牌价终审闸门。
 * 纯函数,无 mock。
 */
import { describe, expect, it } from "vitest";

import {
  channelProblems,
  decidePricingReview,
  HEALTH_THRESHOLDS,
  pricingProblems,
  queueProblems,
  sortProblems,
  trimProblems,
  videoProblems,
  type PricingHealthInput,
} from "./health-report";

const pricingRow = (over: Partial<PricingHealthInput>): PricingHealthInput => ({
  key: "deepseek",
  label: "DeepSeek 模型牌价",
  vendor: "DeepSeek 深度求索",
  enabled: true,
  status: "healthy",
  consecutiveFails: 0,
  rows: { total: 10, pending: 0, enabled: 10, disabled: 0, recheck: 0 },
  lastCapture: {
    at: new Date("2026-11-19T00:00:00Z"),
    parseStatus: "success",
    rowCount: 10,
    error: null,
  },
  ...over,
});

describe("pricingProblems", () => {
  it("源已挂(status=error / 连败≥3)→ critical", () => {
    const problems = pricingProblems([
      pricingRow({ status: "error", consecutiveFails: 3, lastCapture: null }),
    ]);
    expect(problems.some((p) => p.severity === "critical" && p.kind === "source_error")).toBe(true);
  });

  it("连败 1~2 / degraded → warning(未升级为已挂)", () => {
    const problems = pricingProblems([pricingRow({ status: "degraded", consecutiveFails: 1 })]);
    expect(problems.every((p) => p.severity === "warning")).toBe(true);
    expect(problems.some((p) => p.kind === "source_degraded")).toBe(true);
  });

  it("整源「待复核」标(采集失败后旧行被打标)→ critical", () => {
    const problems = pricingProblems([
      pricingRow({ rows: { total: 10, pending: 0, enabled: 9, disabled: 0, recheck: 1 } }),
    ]);
    const p = problems.find((x) => x.kind === "rows_recheck");
    expect(p?.severity).toBe("critical");
  });

  it("待终审积压超阈值 → warning;未超不出", () => {
    const over = pricingProblems([
      pricingRow({ rows: { total: 200, pending: 51, enabled: 149, disabled: 0, recheck: 0 } }),
    ]);
    expect(over.some((p) => p.kind === "rows_pending")).toBe(true);
    const under = pricingProblems([
      pricingRow({ rows: { total: 100, pending: 50, enabled: 50, disabled: 0, recheck: 0 } }),
    ]);
    expect(under.some((p) => p.kind === "rows_pending")).toBe(false);
  });

  it("停用的源不判问题(没在跑不算坏)", () => {
    const problems = pricingProblems([
      pricingRow({ enabled: false, status: "error", consecutiveFails: 9, lastCapture: null }),
    ]);
    expect(problems).toHaveLength(0);
  });

  it("最近快照解析失败 → critical 且带错误原文", () => {
    const problems = pricingProblems([
      pricingRow({
        lastCapture: {
          at: new Date("2026-11-19T00:00:00Z"),
          parseStatus: "failed",
          rowCount: null,
          error: "页面改版:表头对不上",
        },
      }),
    ]);
    const p = problems.find((x) => x.kind === "capture_error");
    expect(p?.severity).toBe("critical");
    expect(p?.evidence).toContain("表头对不上");
  });
});

describe("channelProblems / videoProblems", () => {
  it("渠道连败≥3 → critical;连败 1 → warning;停用不算", () => {
    const base = {
      id: 1,
      name: "厂商动态",
      type: "vendor",
      enabled: true,
      status: "healthy",
      lastRunAt: null,
      nextRunAt: null,
      count24h: 0,
    };
    expect(
      channelProblems([{ ...base, consecutiveFails: HEALTH_THRESHOLDS.consecutiveFails }])[0]
        ?.severity,
    ).toBe("critical");
    expect(channelProblems([{ ...base, consecutiveFails: 1 }])[0]?.severity).toBe("warning");
    expect(channelProblems([{ ...base, enabled: false, consecutiveFails: 9 }])).toHaveLength(0);
  });

  it("博主连败≥3 → critical 且带 lastError;平台行停用的不判", () => {
    const base = {
      id: 7,
      nickname: "某博主",
      platform: "douyin",
      enabled: true,
      platformEnabled: true,
      consecutiveFails: 3,
      lastError: "风控 403",
      lastRunAt: null,
    };
    const p = videoProblems([base])[0];
    expect(p?.severity).toBe("critical");
    expect(p?.evidence).toContain("403");
    expect(videoProblems([{ ...base, platformEnabled: false }])).toHaveLength(0);
  });
});

describe("queueProblems", () => {
  const q = (over: Partial<Parameters<typeof queueProblems>[0][number]> = {}) => ({
    name: "crawler",
    counts: { waiting: 0, active: 0, completed: 10, failed: 0, delayed: 0 },
    tickAlive: true,
    recentFailed: [],
    ...over,
  });

  it("tick 不存活 → critical(定时任务没在跑)", () => {
    const p = queueProblems([q({ tickAlive: false })])[0];
    expect(p?.kind).toBe("tick_dead");
    expect(p?.severity).toBe("critical");
  });

  it("有失败任务 → warning;最老 waiting 超 30 分钟 → warning(积压)", () => {
    expect(
      queueProblems([
        q({ counts: { waiting: 0, active: 0, completed: 0, failed: 2, delayed: 0 } }),
      ])[0]?.severity,
    ).toBe("warning");
    const backlog = queueProblems([
      q({
        counts: { waiting: 5, active: 1, completed: 0, failed: 0, delayed: 0 },
        oldestWaitingMs: 60 * 60 * 1000,
      }),
    ])[0];
    expect(backlog?.kind).toBe("queue_backlog");
  });

  it("AI 队列逼近日配额 → warning", () => {
    const p = queueProblems([q({ name: "interpreter", todayDone: 95, dailyMax: 100 })])[0];
    expect(p?.kind).toBe("quota_near");
  });
});

describe("sortProblems / trimProblems", () => {
  it("critical 排前;截断时给出 truncated 数(不静默丢)", () => {
    const problems = [
      {
        domain: "queue" as const,
        kind: "queue_failed",
        severity: "warning" as const,
        target: "q",
        summary: "s",
        suggest: "x",
      },
      {
        domain: "pricing" as const,
        kind: "source_error",
        severity: "critical" as const,
        target: "p",
        summary: "s",
        suggest: "x",
      },
    ];
    expect(sortProblems(problems)[0]?.severity).toBe("critical");
    const trimmed = trimProblems(problems, 1);
    expect(trimmed.items).toHaveLength(1);
    expect(trimmed.truncated).toBe(1);
  });
});

describe("decidePricingReview(牌价终审闸门)", () => {
  const row = (over: Partial<Parameters<typeof decidePricingReview>[0][number]> = {}) => ({
    id: "1",
    vendor: "DeepSeek 深度求索",
    modelKey: "deepseek-chat",
    status: "pending",
    note: null,
    ...over,
  });
  const healthy = { status: "healthy", consecutiveFails: 0 };

  it("上架:带「待复核」标 → 拒(价已陈旧)", () => {
    const d = decidePricingReview(
      [row({ note: "【待复核 2026-11-18】旧行" })],
      "enabled",
      () => healthy,
    );
    expect(d[0]?.action).toBe("reject");
    expect(d[0]?.reason).toContain("待复核");
  });

  it("上架:采集源不健康(status=error / 连败≥3)→ 拒", () => {
    const bad = { status: "error", consecutiveFails: 0 };
    expect(decidePricingReview([row()], "enabled", () => bad)[0]?.action).toBe("reject");
    const fails = { status: "healthy", consecutiveFails: HEALTH_THRESHOLDS.consecutiveFails };
    expect(decidePricingReview([row()], "enabled", () => fails)[0]?.action).toBe("reject");
  });

  it("上架:找不到对应源 → 拒(无法确认数据新鲜度)", () => {
    expect(decidePricingReview([row()], "enabled", () => undefined)[0]?.action).toBe("reject");
  });

  it("上架:源健康且无待复核标 → apply;已同态行 → skip", () => {
    expect(decidePricingReview([row()], "enabled", () => healthy)[0]?.action).toBe("apply");
    const same = decidePricingReview([row({ status: "enabled" })], "enabled", () => healthy);
    expect(same[0]?.action).toBe("skip");
  });

  it("下架:不受待复核/源健康两道闸(止损优先)", () => {
    const d = decidePricingReview(
      [row({ note: "【待复核】旧行", status: "enabled" })],
      "disabled",
      () => ({ status: "error", consecutiveFails: 9 }),
    );
    expect(d[0]?.action).toBe("apply");
  });
});
