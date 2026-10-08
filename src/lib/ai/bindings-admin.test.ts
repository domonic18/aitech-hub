/**
 * 绑定选型校验单测(validateBindingSelection 纯函数):
 * 五分支(不存在/停用/用途不符/主备相同/合法)与双 null 解绑。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../env", () => ({ env: { AUTH_SECRET: "unit-test-auth-secret-0123456789" } }));

import { validateBindingSelection } from "./bindings-admin";

const MODELS = [
  { id: 1, enabled: true, purposes: ["interpret", "summarize"] },
  { id: 2, enabled: false, purposes: ["interpret"] },
  { id: 3, enabled: true, purposes: ["cover"] },
];

describe("validateBindingSelection", () => {
  it("双 null(解绑)与合法选择 → null", () => {
    expect(validateBindingSelection(MODELS, "interpret", null, null)).toBeNull();
    expect(validateBindingSelection(MODELS, "interpret", 1, null)).toBeNull();
    expect(validateBindingSelection(MODELS, "cover", null, 3)).toBeNull();
  });

  it("引用不存在 → not_found;停用 → disabled", () => {
    expect(validateBindingSelection(MODELS, "interpret", 99, null)?.code).toBe("not_found");
    expect(validateBindingSelection(MODELS, "interpret", 2, null)?.code).toBe("disabled");
    expect(validateBindingSelection(MODELS, "interpret", null, 2)?.code).toBe("disabled");
  });

  it("用途不含该角色 → invalid(含角色名)", () => {
    const err = validateBindingSelection(MODELS, "search", 1, null);
    expect(err?.code).toBe("invalid");
    expect(err?.message).toContain("Agent 搜索");
  });

  it("主力=备用 → invalid", () => {
    expect(validateBindingSelection(MODELS, "interpret", 1, 1)?.code).toBe("invalid");
  });
});
