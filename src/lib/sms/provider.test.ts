/**
 * 服务商错误归类单测(M65):归类是 Route Handler 决定 HTTP 语义的稳定契约,
 * 前缀/大小写/未知码都必须落在确定分支。
 */
import { describe, expect, it } from "vitest";

import { classifyProviderCode } from "./provider";

describe("classifyProviderCode", () => {
  it("空码视为未知错误", () => {
    expect(classifyProviderCode(null)).toBe("provider_error");
    expect(classifyProviderCode(undefined)).toBe("provider_error");
    expect(classifyProviderCode("")).toBe("provider_error");
  });

  it("频控类 → rate_limited", () => {
    expect(classifyProviderCode("isv.BUSINESS_LIMIT_CONTROL")).toBe("rate_limited");
    expect(classifyProviderCode("isv.FREQUENCY_LIMIT")).toBe("rate_limited");
    expect(classifyProviderCode("Throttling.User")).toBe("rate_limited");
  });

  it("额度类 → quota_exhausted", () => {
    expect(classifyProviderCode("isv.AMOUNT_NOT_ENOUGH")).toBe("quota_exhausted");
    expect(classifyProviderCode("isv.OUT_OF_BALANCE")).toBe("quota_exhausted");
    expect(classifyProviderCode("QUOTA_EXCEEDED")).toBe("quota_exhausted");
  });

  it("配置类 → config_invalid", () => {
    expect(classifyProviderCode("isv.SMS_SIGNATURE_ILLEGAL")).toBe("config_invalid");
    expect(classifyProviderCode("isv.TEMPLATE_DOES_NOT_EXIST")).toBe("config_invalid");
    expect(classifyProviderCode("isv.TEMPLATE_PARAMS_ILLEGAL")).toBe("config_invalid");
    expect(classifyProviderCode("isv.UNAUTHORIZED")).toBe("config_invalid");
    expect(classifyProviderCode("SignatureDoesNotMatch")).toBe("config_invalid");
    // 真实 SDK 探针实证:坏 AccessKey 曾被误归 provider_error(2026-10-31)
    expect(classifyProviderCode("InvalidAccessKeyId.NotFound")).toBe("config_invalid");
    expect(classifyProviderCode("NoPermission")).toBe("config_invalid");
    expect(classifyProviderCode("Forbidden.RAM")).toBe("config_invalid");
  });

  it("未识别业务码 → provider_error(不误判为可重试语义)", () => {
    expect(classifyProviderCode("isv.SMS_SERVICE_ERROR")).toBe("provider_error");
    expect(classifyProviderCode("InternalError")).toBe("provider_error");
  });
});
