/**
 * PNVS 适配单测(M65):SDK 整体替身,只验本站侧的协议映射——
 * 请求参数口径(有效期/间隔/位数/覆盖策略/不回传明文码)、成功判定
 * (success && code === "OK")、校验结果判定(PASS 才算通过)、抛错归类。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ send: vi.fn(), check: vi.fn() }));

vi.mock("@alicloud/openapi-core", () => ({
  $OpenApiUtil: {
    Config: class {
      [k: string]: unknown;
    },
  },
}));

vi.mock("@alicloud/dypnsapi20170525", () => ({
  default: class {
    sendSmsVerifyCode = sdk.send;
    checkSmsVerifyCode = sdk.check;
  },
  SendSmsVerifyCodeRequest: class {
    [k: string]: unknown;
    constructor(init: Record<string, unknown>) {
      Object.assign(this, init);
    }
  },
  CheckSmsVerifyCodeRequest: class {
    [k: string]: unknown;
    constructor(init: Record<string, unknown>) {
      Object.assign(this, init);
    }
  },
}));

import { AliyunPnvsProvider } from "./aliyun-pnvs";

const provider = new AliyunPnvsProvider({ accessKeyId: "ak", accessKeySecret: "sk" });

const BASE_INPUT = { phone: "13812341234", signName: "恒创联众", templateCode: "100001" };

beforeEach(() => {
  sdk.send.mockReset();
  sdk.check.mockReset();
});

describe("sendVerifyCode", () => {
  it("成功:回传 bizId/requestId,并按缺省口径下发", async () => {
    sdk.send.mockResolvedValue({
      body: { success: true, code: "OK", requestId: "req-1", model: { bizId: "biz-1" } },
    });
    expect(await provider.sendVerifyCode(BASE_INPUT)).toEqual({
      ok: true,
      bizId: "biz-1",
      requestId: "req-1",
    });

    const req = sdk.send.mock.calls[0][0] as Record<string, unknown>;
    expect(req).toMatchObject({
      phoneNumber: "13812341234",
      signName: "恒创联众",
      templateCode: "100001",
      validTime: 300,
      interval: 60,
      codeLength: 6,
      codeType: 1,
      duplicatePolicy: 1,
      returnVerifyCode: false,
    });
    // 明文验证码永不出服务商:模板变量只传占位符
    expect(req.templateParam).toBe(JSON.stringify({ code: "##code##" }));
  });

  it("调用方可收紧有效期/间隔/位数", async () => {
    sdk.send.mockResolvedValue({ body: { success: true, code: "OK" } });
    await provider.sendVerifyCode({
      ...BASE_INPUT,
      validTimeSeconds: 180,
      intervalSeconds: 120,
      codeLength: 4,
      outId: "out-1",
    });
    expect(sdk.send.mock.calls[0][0]).toMatchObject({
      validTime: 180,
      interval: 120,
      codeLength: 4,
      outId: "out-1",
    });
  });

  it("success=true 但 code 非 OK 仍判失败", async () => {
    sdk.send.mockResolvedValue({ body: { success: true, code: "isv.BUSINESS_LIMIT_CONTROL" } });
    const r = await provider.sendVerifyCode(BASE_INPUT);
    expect(r).toMatchObject({
      ok: false,
      reason: "rate_limited",
      code: "isv.BUSINESS_LIMIT_CONTROL",
    });
  });

  it("业务失败码按契约归类", async () => {
    sdk.send.mockResolvedValue({
      body: { success: false, code: "isv.AMOUNT_NOT_ENOUGH", message: "账户余额不足" },
    });
    expect(await provider.sendVerifyCode(BASE_INPUT)).toEqual({
      ok: false,
      reason: "quota_exhausted",
      code: "isv.AMOUNT_NOT_ENOUGH",
      message: "账户余额不足",
    });
  });

  it("SDK 抛错:取 code/message 归类,不向调用方泄栈", async () => {
    sdk.send.mockRejectedValue({ code: "isv.SMS_SIGNATURE_ILLEGAL", message: "签名不合法" });
    expect(await provider.sendVerifyCode(BASE_INPUT)).toEqual({
      ok: false,
      reason: "config_invalid",
      code: "isv.SMS_SIGNATURE_ILLEGAL",
      message: "签名不合法",
    });
  });

  it("非对象抛错退化为 provider_error", async () => {
    sdk.send.mockRejectedValue("boom");
    expect(await provider.sendVerifyCode(BASE_INPUT)).toMatchObject({
      ok: false,
      reason: "provider_error",
      code: null,
      message: "boom",
    });
  });
});

describe("checkVerifyCode", () => {
  it("verifyResult=PASS 才算通过", async () => {
    sdk.check.mockResolvedValue({
      body: { success: true, code: "OK", model: { verifyResult: "PASS" } },
    });
    expect(await provider.checkVerifyCode({ phone: "13812341234", code: "7658" })).toEqual({
      ok: true,
    });
    expect(sdk.check.mock.calls[0][0]).toMatchObject({
      phoneNumber: "13812341234",
      verifyCode: "7658",
      caseAuthPolicy: 1,
    });
  });

  it("非 PASS → mismatch(业务失败,不是通道故障)", async () => {
    sdk.check.mockResolvedValue({
      body: { success: true, code: "OK", model: { verifyResult: "UNKNOWN" } },
    });
    expect(await provider.checkVerifyCode({ phone: "13812341234", code: "0000" })).toMatchObject({
      ok: false,
      reason: "mismatch",
    });
  });

  it("通道失败码按契约归类", async () => {
    sdk.check.mockResolvedValue({
      body: { success: false, code: "isv.TEMPLATE_DOES_NOT_EXIST", message: "模板不存在" },
    });
    expect(await provider.checkVerifyCode({ phone: "13812341234", code: "7658" })).toMatchObject({
      ok: false,
      reason: "config_invalid",
    });
  });
});
