/**
 * 键形契约单测(2026-11-01 批C):构造与解析必须互逆,畸形键一律 null。
 * 这里守的是「写侧拼的键,flush 侧一定认得」——此前两侧各写一份下标,只能靠线上发现。
 */
import { describe, expect, it } from "vitest";

import { bufferKey, parseBufferKey } from "./keys";

describe("bufferKey / parseBufferKey 互逆", () => {
  it.each(["visit", "ref", "client", "post", "geo"] as const)("%s 类往返一致", (kind) => {
    const key = bufferKey(kind, "2026-11-01");
    expect(key).toBe(`stats:buf:${kind}:2026-11-01`);
    expect(parseBufferKey(key)).toEqual({ kind, day: "2026-11-01" });
  });

  it.each(["pv", "uv"] as const)("page:%s 往返一致", (metric) => {
    const key = bufferKey("page", "2026-11-01", metric);
    expect(key).toBe(`stats:buf:page:2026-11-01:${metric}`);
    expect(parseBufferKey(key)).toEqual({ kind: "page", day: "2026-11-01", metric });
  });
});

describe("parseBufferKey 拒绝畸形键", () => {
  it.each([
    ["非缓冲前缀", "stats:uv:2026-11-01:abc"],
    ["私有暂存键", "stats:flushing:xyz:stats:buf:visit:2026-11-01"],
    ["缺 day", "stats:buf:visit"],
    ["多一段", "stats:buf:visit:2026-11-01:pv"],
    ["未知 kind", "stats:buf:whatever:2026-11-01"],
    ["page 缺 metric", "stats:buf:page:2026-11-01"],
    ["page metric 非法", "stats:buf:page:2026-11-01:hits"],
  ])("%s → null", (_label, key) => {
    expect(parseBufferKey(key)).toBeNull();
  });
});
