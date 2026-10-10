/**
 * 评论/点赞限流单测(M23 批①):Redis 用内存 Map 替身(rate-limit 同款),
 * 钉桶 key 格式、双闸取或、空 IP 不进桶。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@/lib/redis", () => ({
  redis: {
    get: async (k: string) => store.get(k) ?? null,
    incr: async (k: string) => {
      const n = Number(store.get(k) ?? "0") + 1;
      store.set(k, String(n));
      return n;
    },
    expire: async () => 1,
  },
}));

import {
  COMMENT_IP_LIMIT,
  COMMENT_LIST_IP_LIMIT,
  COMMENT_USER_LIMIT,
  LIKE_IDENTITY_LIMIT,
  LIKE_IP_LIMIT,
  commentIpBucket,
  commentListIpBucket,
  commentUserBucket,
  commentListOverLimit,
  commentWriteOverLimit,
  likeIdentityBucket,
  likeIpBucket,
  likeOverLimit,
  recordCommentListHit,
  recordCommentWrite,
  recordLikeHit,
} from "./limit";

describe("桶 key 格式(单测钉格式,键空间互不重叠)", () => {
  it("发评双桶 / 点赞双桶 / 列表桶", () => {
    expect(commentUserBucket(BigInt(42))).toBe("comment:u:42");
    expect(commentIpBucket("1.2.3.4")).toBe("comment:ip:1.2.3.4");
    expect(likeIdentityBucket("v:abcd")).toBe("like:idt:v:abcd");
    expect(likeIpBucket("1.2.3.4")).toBe("like:ip:1.2.3.4");
    expect(commentListIpBucket("1.2.3.4")).toBe("comment:list:ip:1.2.3.4");
  });
});

describe("commentWriteOverLimit(用户 10/时 + IP 30/时)", () => {
  beforeEach(() => store.clear());

  it("任一闸达限即拦;两闸独立计数", async () => {
    const userId = BigInt(7);
    const ip = "203.0.113.5";
    for (let i = 0; i < COMMENT_USER_LIMIT; i++) await recordCommentWrite(userId, "");
    expect(await commentWriteOverLimit(userId, "")).toBe(true);
    // 另一用户同 IP 不受用户闸影响,IP 闸仍放行至阈值
    expect(await commentWriteOverLimit(BigInt(8), ip)).toBe(false);
    for (let i = 0; i < COMMENT_IP_LIMIT; i++) await recordCommentWrite(BigInt(8), ip);
    expect(await commentWriteOverLimit(BigInt(8), ip)).toBe(true);
  });

  it("空 IP 不进 IP 桶(本机调试)", async () => {
    expect(await commentWriteOverLimit(BigInt(1), "")).toBe(false);
    await recordCommentWrite(BigInt(1), "");
    expect(store.has("comment:ip:")).toBe(false);
  });
});

describe("likeOverLimit(身份 60/时 + IP 240/时)", () => {
  beforeEach(() => store.clear());

  it("身份闸与 IP 闸分别达限即拦", async () => {
    const key = "v:uuid-1";
    const ip = "203.0.113.6";
    for (let i = 0; i < LIKE_IDENTITY_LIMIT; i++) await recordLikeHit(key, "");
    expect(await likeOverLimit(key, "")).toBe(true);
    expect(await likeOverLimit("v:uuid-2", ip)).toBe(false);
    for (let i = 0; i < LIKE_IP_LIMIT; i++) await recordLikeHit("v:uuid-2", ip);
    expect(await likeOverLimit("v:uuid-2", ip)).toBe(true);
    expect(await likeOverLimit("v:uuid-3", "")).toBe(false);
  });
});

describe("commentListOverLimit(IP 120/分)", () => {
  beforeEach(() => store.clear());

  it("达限即拦;空 IP 恒放行不计数", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < COMMENT_LIST_IP_LIMIT; i++) await recordCommentListHit(ip);
    expect(await commentListOverLimit(ip)).toBe(true);
    expect(await commentListOverLimit("")).toBe(false);
    expect(store.has("comment:list:ip:")).toBe(false);
  });
});
