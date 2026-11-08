/**
 * 内容类采集白名单单测(M69):公开右栏只展示内容链路任务,运维/对账/清理/
 * 汇率/体检一律排除;registry key 由 jobRunKey 反查,不另立手工映射。
 */
import { describe, expect, it } from "vitest";

import { SCHEDULE_REGISTRY } from "./schedules";
import { isContentJobKey, isContentScheduleKey, CONTENT_JOB_KEYS } from "./content-scope";

describe("isContentJobKey", () => {
  it("内容链路任务在册(采集/解读/洞察/发现)", () => {
    for (const key of [
      "crawler/crawl",
      "crawler/ai-backfill",
      "insight/fetch",
      "insight/daily",
      "insight/label",
      "insight/embed",
      "insight/translate",
      "discovery/discovery-hotwords",
      "discovery/discovery-bili",
    ]) {
      expect(isContentJobKey(key)).toBe(true);
    }
  });

  it("运维/对账/清理/汇率/体检一律排除", () => {
    for (const key of [
      "db-backup/run",
      "pay-reconcile/daily-audit",
      "stats/purge-visit-log",
      "stats/purge-usage-log",
      "stats/purge-agent-session",
      "stats/purge-job-run",
      "wechat-mp/purge",
      "cover-gen/temp-sweep",
      "media-audit/audit",
      "crawler/leaderboard-fx-refresh",
    ]) {
      expect(isContentJobKey(key)).toBe(false);
    }
  });

  it("白名单无重复", () => {
    expect(new Set(CONTENT_JOB_KEYS).size).toBe(CONTENT_JOB_KEYS.length);
  });
});

describe("isContentScheduleKey", () => {
  it("登记表内内容任务放行,其余排除", () => {
    for (const key of [
      "insight-fetch",
      "insight-daily",
      "insight-label",
      "insight-embed",
      "insight-translate",
      "discovery-hotwords",
      "discovery-bili",
    ]) {
      expect(isContentScheduleKey(key)).toBe(true);
    }
    for (const key of [
      "db-backup",
      "media-audit",
      "pay-daily-audit",
      "leaderboard-fx",
      "visit-purge",
      "job-run-purge",
      "wechat-mp-purge",
      "usage-purge",
      "cover-sweep",
      "agent-purge",
      "embed-reconcile",
    ]) {
      expect(isContentScheduleKey(key)).toBe(false);
    }
  });

  it("与登记表 jobRunKey 一一对齐(不出现悬空白名单键)", () => {
    const fromRegistry = SCHEDULE_REGISTRY.filter(
      (d) => d.jobRunKey !== undefined && isContentJobKey(d.jobRunKey),
    ).map((d) => d.key);
    expect(fromRegistry.every((k) => isContentScheduleKey(k))).toBe(true);
    expect(fromRegistry.length).toBeGreaterThan(0);
  });
});
