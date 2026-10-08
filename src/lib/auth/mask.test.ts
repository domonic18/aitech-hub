import { describe, expect, it } from "vitest";

import { maskPhone } from "./mask";

describe("maskPhone(日志脱敏,arch/05-services §3.1)", () => {
  it("11 位规范手机号 → 前 3 后 4", () => {
    expect(maskPhone("13812341234")).toBe("138****1234");
    expect(maskPhone("19900000000")).toBe("199****0000");
  });

  it("非规范格式/空值 → 全掩码,不泄漏片段", () => {
    expect(maskPhone("12345")).toBe("***");
    expect(maskPhone("not-a-phone")).toBe("***");
    expect(maskPhone("")).toBe("***");
    expect(maskPhone(null)).toBe("***");
    expect(maskPhone(undefined)).toBe("***");
  });
});
