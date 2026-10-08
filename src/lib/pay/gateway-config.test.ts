/**
 * 支付配置 schema 纯函数单测(M21 批②):mode 三态、xunhu 凭据必填
 * (appId/apiBase,secret 留空保留语义)、off/mock 凭据可整块留空、
 * 回调/回跳 https-or-empty、TTL 边界;mock 生产环境拒绝
 * (assertModeAllowedInEnv,双护栏之保存侧)。DB 读写由集成测试覆盖。
 */
import { describe, expect, it } from "vitest";

import {
  assertModeAllowedInEnv,
  PayGatewayConfigUpdateSchema,
  maskSecret,
} from "@/lib/pay/gateway-config";

const XUNHU_BASE = {
  mode: "xunhu",
  appId: "1234567890",
  apiBase: "https://api.dpweixin.com",
} as const;

describe("PayGatewayConfigUpdateSchema(模式即总闸,凭据按 mode 校验)", () => {
  it("xunhu:appId/apiBase 必填(https);缺 appSecret 合法(留空保留语义,路由层把关首启)", () => {
    const parsed = PayGatewayConfigUpdateSchema.parse(XUNHU_BASE);
    expect(parsed.mode).toBe("xunhu");
    expect(parsed.orderTtlMin).toBe(30); // TTL 缺省回落
    expect(parsed.notifyUrl).toBe("");

    expect(() => PayGatewayConfigUpdateSchema.parse({ ...XUNHU_BASE, appId: "abc" })).toThrow(
      /appId/,
    );
    expect(() =>
      PayGatewayConfigUpdateSchema.parse({ ...XUNHU_BASE, apiBase: "http://api.dpweixin.com" }),
    ).toThrow(/apiBase/);
  });

  it("off/mock:凭据字段可整块留空(先填后开、mock 零凭据)", () => {
    const off = PayGatewayConfigUpdateSchema.parse({ mode: "off" });
    expect(off.appId).toBe("");
    expect(off.apiBase).toBe("");

    const mock = PayGatewayConfigUpdateSchema.parse({ mode: "mock", orderTtlMin: 15 });
    expect(mock.orderTtlMin).toBe(15);
  });

  it("mode 仅三态;回调/回跳须 https 或留空;TTL 1-1440", () => {
    expect(() => PayGatewayConfigUpdateSchema.parse({ mode: "stripe" })).toThrow();
    expect(() =>
      PayGatewayConfigUpdateSchema.parse({ mode: "off", notifyUrl: "http://x.com" }),
    ).toThrow(/https/);
    expect(PayGatewayConfigUpdateSchema.parse({ mode: "off", notifyUrl: "" }).notifyUrl).toBe("");
    expect(() => PayGatewayConfigUpdateSchema.parse({ mode: "off", orderTtlMin: 0 })).toThrow();
    expect(() => PayGatewayConfigUpdateSchema.parse({ mode: "off", orderTtlMin: 1441 })).toThrow();
    expect(PayGatewayConfigUpdateSchema.parse({ mode: "off", orderTtlMin: "45" }).orderTtlMin).toBe(
      45,
    );
  });
});

describe("assertModeAllowedInEnv(mock 生产拒绝,双护栏之保存侧)", () => {
  it("production + mock 抛错;development/test + mock 放行;xunhu/off 恒放行", () => {
    // env.NODE_ENV 是模块加载时快照,stubEnv 无效——nodeEnv 走注入参数
    expect(() => assertModeAllowedInEnv("mock", "production")).toThrow(/仅开发环境/);
    expect(() => assertModeAllowedInEnv("xunhu", "production")).not.toThrow();
    expect(() => assertModeAllowedInEnv("off", "production")).not.toThrow();
    expect(() => assertModeAllowedInEnv("mock", "development")).not.toThrow();
    expect(() => assertModeAllowedInEnv("mock", "test")).not.toThrow();
  });
});

describe("maskSecret(掩码形态)", () => {
  it("8+ 字符首四尾四打码;过短整体隐藏", () => {
    expect(maskSecret("9191111122223184")).toBe("9191…3184");
    expect(maskSecret("short")).toBe("…");
  });
});
