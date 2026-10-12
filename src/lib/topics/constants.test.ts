/**
 * 专题状态机单测(M26 批①,方案 §3/§10-7):流转矩阵钉死。
 */
import { describe, expect, it } from "vitest";

import { canTransition, MANUAL_STATUS_TARGETS, TOPIC_STATUS, type TopicStatus } from "./constants";

describe("canTransition(专题状态机)", () => {
  it("合法路径:collecting→drafted→published 主线 + 人工回退", () => {
    expect(canTransition("collecting", "drafted")).toBe(true);
    expect(canTransition("drafted", "published")).toBe(true);
    expect(canTransition("published", "drafted")).toBe(true);
    expect(canTransition("drafted", "collecting")).toBe(true);
    // publish 钩子旁路:人工关联文章发布不经合成
    expect(canTransition("collecting", "published")).toBe(true);
  });

  it("非法路径:终态逆跳与同态以外的越级", () => {
    expect(canTransition("collecting", "collecting")).toBe(false);
    expect(canTransition("published", "collecting")).toBe(false);
    expect(canTransition("published", "published")).toBe(false);
  });

  it("状态枚举完备:三态(合法值应用层 Zod 管控,arch/03 枚举演进条款)", () => {
    expect(TOPIC_STATUS).toEqual(["collecting", "drafted", "published"]);
  });

  it("人工迁移钮组(§10-7):不含 collecting→drafted(仅合成驱动),均在状态机合法集内", () => {
    expect(MANUAL_STATUS_TARGETS.collecting).toEqual(["published"]);
    expect(MANUAL_STATUS_TARGETS.drafted).toEqual(["collecting", "published"]);
    expect(MANUAL_STATUS_TARGETS.published).toEqual(["drafted"]);
    for (const [from, targets] of Object.entries(MANUAL_STATUS_TARGETS)) {
      for (const to of targets) {
        expect(canTransition(from as TopicStatus, to)).toBe(true);
      }
    }
  });
});
