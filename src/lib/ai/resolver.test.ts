/**
 * 绑定解析纯函数单测(pickBoundModel):主力优先、停用回落备用、双停用 null。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../env", () => ({ env: { AUTH_SECRET: "unit-test-auth-secret-0123456789" } }));

import { pickBoundModel } from "./resolver";

describe("pickBoundModel", () => {
  it("主力启用 → primary;主力停用 → backup;主力缺失 → backup", () => {
    expect(pickBoundModel({ enabled: true }, { enabled: true })).toBe("primary");
    expect(pickBoundModel({ enabled: false }, { enabled: true })).toBe("backup");
    expect(pickBoundModel(null, { enabled: true })).toBe("backup");
  });

  it("主力缺失且备用停用/双 null → null(消费方降级)", () => {
    expect(pickBoundModel(null, { enabled: false })).toBeNull();
    expect(pickBoundModel({ enabled: false }, null)).toBeNull();
    expect(pickBoundModel(null, null)).toBeNull();
  });
});
