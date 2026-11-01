/**
 * 绑定场景契约单测(M65 P1):schema 边界是「该发往谁」的第一道闸,
 * 客户端与服务端共用;错误码 → HTTP 映射必须全覆盖(类型层已约束,此处锁值)。
 */
import { describe, expect, it } from "vitest";

import {
  PHONE_BIND_ERROR_STATUS,
  phoneCodeSchema,
  phoneVerifySchema,
  SMS_TEMPLATE,
} from "./scenes";

describe("phoneCodeSchema", () => {
  it("rebind_old 不收手机号(目标号由服务端取)", () => {
    expect(phoneCodeSchema.safeParse({ scene: "rebind_old" }).success).toBe(true);
  });

  it("bind / rebind_new 必须带合法手机号", () => {
    expect(phoneCodeSchema.safeParse({ scene: "bind" }).success).toBe(false);
    expect(phoneCodeSchema.safeParse({ scene: "bind", phone: "12345" }).success).toBe(false);
    expect(phoneCodeSchema.safeParse({ scene: "bind", phone: "13900001234" }).success).toBe(true);
    expect(phoneCodeSchema.safeParse({ scene: "rebind_new" }).success).toBe(false);
  });

  it("未知场景拒绝", () => {
    expect(phoneCodeSchema.safeParse({ scene: "reset", phone: "13900001234" }).success).toBe(false);
  });
});

describe("phoneVerifySchema", () => {
  it("验证码须 4-8 位数字", () => {
    const base = { scene: "rebind_old" as const };
    expect(phoneVerifySchema.safeParse({ ...base, code: "123" }).success).toBe(false);
    expect(phoneVerifySchema.safeParse({ ...base, code: "12a4" }).success).toBe(false);
    expect(phoneVerifySchema.safeParse({ ...base, code: "1234" }).success).toBe(true);
    expect(phoneVerifySchema.safeParse({ ...base, code: "12345678" }).success).toBe(true);
    expect(phoneVerifySchema.safeParse({ ...base, code: "123456789" }).success).toBe(false);
  });
});

describe("契约常量", () => {
  it("PNVS 预置模板编码固定", () => {
    expect(SMS_TEMPLATE).toEqual({
      login: "100001",
      rebindNew: "100002",
      resetPassword: "100003",
      bindNew: "100004",
      verifyCurrent: "100005",
    });
  });

  it("错误码 → 状态码覆盖全部编码", () => {
    expect(PHONE_BIND_ERROR_STATUS).toEqual({
      not_found: 404,
      phone_taken: 409,
      same_phone: 400,
      admin_forbidden: 403,
      flow_required: 409,
      has_phone: 400,
      no_phone: 400,
      invalid_new_phone: 400,
      inactive: 403,
    });
  });
});
