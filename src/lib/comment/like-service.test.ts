/**
 * 点赞身份键单测(M23 批①):三路身份 → identityKey 的映射钉死——点赞去重
 * 的根基,键型变化必须在这里先红。纯函数,零 IO。
 */
import { describe, expect, it } from "vitest";

import { buildIdentityKey } from "./like-service";

describe("buildIdentityKey(身份 → 去重键)", () => {
  it("游客 → v:<ah_av uuid>", () => {
    expect(
      buildIdentityKey({
        kind: "guest",
        key: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
        fresh: false,
      }),
    ).toBe("v:6f9619ff-8b86-d011-b42d-00c04fc964ff");
  });

  it("登录用户 → u:<userId>(与 admin 同空间:同人一行一赞)", () => {
    expect(buildIdentityKey({ kind: "user", key: "user:123", userId: BigInt(123) })).toBe("u:123");
  });

  it("admin → u:<userId>(admin 也是 user_account 行)", () => {
    expect(buildIdentityKey({ kind: "admin", key: "admin:1" })).toBe("u:1");
  });

  it("键长上限 42 列宽内(v:<36位 uuid> = 38)", () => {
    const key = buildIdentityKey({
      kind: "guest",
      key: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
      fresh: true,
    });
    expect(key.length).toBeLessThanOrEqual(42);
  });
});
