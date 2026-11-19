/**
 * 运营巡查健康度判定单测(M75 运维面):problems 判定口径 + 牌价终审闸门。
 * 纯函数,无 mock。
 */
import { describe, expect, it } from "vitest";

import {
  channelProblems,
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
