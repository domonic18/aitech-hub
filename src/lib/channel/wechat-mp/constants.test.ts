import { describe, expect, it } from "vitest";

import { wechatMpAnswerJobId } from "./constants";

describe("wechatMpAnswerJobId", () => {
  // 2026-11-01 线上回归:BullMQ 自定义 jobId 禁冒号,入站 dedupeKey(`msg:<MsgId>`)
  // 直接拼装会让 queue.add 抛「Custom Id cannot contain :」,整条 L1 链路降级成错误话术。
  it("不含冒号(BullMQ 自定义 id 硬约束)", () => {
    const id = wechatMpAnswerJobId(BigInt("2392123456789012"));
    expect(id).not.toContain(":");
    expect(id).toBe("wxmp-2392123456789012");
  });

  it("同一消息 id 稳定(幂等去重依赖确定性)", () => {
    expect(wechatMpAnswerJobId("42")).toBe(wechatMpAnswerJobId(BigInt("42")));
  });

  it("不同消息 id 不碰撞", () => {
    expect(wechatMpAnswerJobId(BigInt("1"))).not.toBe(wechatMpAnswerJobId(BigInt("2")));
  });
});
