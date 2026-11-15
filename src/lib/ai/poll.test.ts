/**
 * pollUntil 单测(技术债批④):首拍命中即返、按步进重试、兜底超时返 null。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { POLL_INTERVAL_MS, POLL_MAX_MS, pollUntil } from "./poll";

afterEach(() => {
  vi.useRealTimers();
});

describe("pollUntil", () => {
  it("首拍命中即返,不再等待", async () => {
    let calls = 0;
    await expect(
      pollUntil(async () => {
        calls += 1;
        return calls === 1 ? "hit" : null;
      }),
    ).resolves.toBe("hit");
    expect(calls).toBe(1);
  });

  it("未命中按步进重试,命中返回当拍结果", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const p = pollUntil<string>(async () => {
      calls += 1;
      return calls >= 3 ? "ok" : null;
    });
    await vi.advanceTimersByTimeAsync(9_000);
    await expect(p).resolves.toBe("ok");
    expect(calls).toBe(3);
  });

  it("超过兜底超时返 null", async () => {
    vi.useFakeTimers();
    const p = pollUntil<string>(async () => null);
    const settled = expect(p).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(POLL_MAX_MS + POLL_INTERVAL_MS);
    await settled;
  });
});
