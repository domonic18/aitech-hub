/**
 * Xunhu 网关纯函数单测(M21 批②):下单/查询参数构造(签名就位、查询
 * 白名单字段——多一个 version 都会 40029)、下单响应验签后取链(§6 #11)、
 * 状态映射、回调验签(坏签全拒)。HTTP 层由集成/联调覆盖,此处不触网。
 */
import { describe, expect, it } from "vitest";

import { makeSign } from "@/lib/pay/sign";
import {
  buildCreateParams,
  buildQueryParams,
  mapGatewayStatus,
  parseCreateResponse,
  parseQueryResponse,
  XunhuGateway,
} from "@/lib/pay/gateway/xunhu";
import type { PayGatewayRuntimeConfig } from "@/lib/pay/gateway-config";

const CFG: PayGatewayRuntimeConfig = {
  appId: "1234567890",
  appSecret: "0123456789abcdef0123456789abcdef",
  apiBase: "https://api.dpweixin.com",
  apiBaseBackup: "https://api.xunhupay.com",
  notifyUrl: "https://17aitech.com/api/pay/notify",
  returnUrl: "https://17aitech.com/pay/done",
  orderTtlMin: 30,
  wapUrl: "https://17aitech.com",
};

const INPUT = {
  orderNo: "2026041219470504845M21",
  amount: "5.00",
  title: "测试文章解锁",
  notifyUrl: "https://17aitech.com/api/pay/notify",
  returnUrl: "https://17aitech.com/post/1-slug",
};

describe("buildCreateParams/buildQueryParams(提案 §2.2/§2.5)", () => {
  it("下单参数:version=1.1/type=WAP/wap 信息就位,hash 为合法签名", () => {
    const p = buildCreateParams(CFG, INPUT);
    expect(p).toMatchObject({
      version: "1.1",
      type: "WAP",
      appid: CFG.appId,
      trade_order_id: INPUT.orderNo,
      total_fee: "5.00",
      wap_url: CFG.wapUrl,
      notify_url: INPUT.notifyUrl,
    });
    const { hash, ...rest } = p;
    expect(hash).toBe(makeSign(rest, CFG.appSecret));
  });

  it("查询参数:仅白名单四字段(appid/out_trade_order/time/nonce_str)+hash,无 version", () => {
    const p = buildQueryParams(CFG, INPUT.orderNo);
    expect(Object.keys(p).sort()).toEqual([
      "appid",
      "hash",
      "nonce_str",
      "out_trade_order",
      "time",
    ]);
    const { hash, ...rest } = p;
    expect(hash).toBe(makeSign(rest, CFG.appSecret));
  });
});

describe("parseCreateResponse(先验签后取链,§6 #11)", () => {
  it("验签通过且 errno=0 → 取 url/url_qrcode/openid(历史命名=网关单号)", () => {
    const body: Record<string, string> = {
      errno: "0",
      errmsg: "成功",
      openid: "202610090001",
      url: "https://pay.example.com/h5",
      url_qrcode: "https://pay.example.com/qr",
    };
    body.hash = makeSign(body, CFG.appSecret);
    expect(parseCreateResponse(body, CFG.appSecret)).toMatchObject({
      payUrl: "https://pay.example.com/h5",
      qrUrl: "https://pay.example.com/qr",
      openOrderId: "202610090001",
    });
  });

  it("验签失败/errno≠0/缺签名 全拒", () => {
    const body: Record<string, string> = { errno: "0", errmsg: "成功", url: "https://x" };
    body.hash = makeSign(body, "ffffffffffffffffffffffffffffffff");
    expect(() => parseCreateResponse(body, CFG.appSecret)).toThrow(/验签失败/);

    const bad: Record<string, string> = { errno: "1", errmsg: "签名错误", url: "https://x" };
    bad.hash = makeSign(bad, CFG.appSecret);
    expect(() => parseCreateResponse(bad, CFG.appSecret)).toThrow(/签名错误/);

    expect(() => parseCreateResponse({ errno: "0", url: "https://x" }, CFG.appSecret)).toThrow(
      /验签失败/,
    );
  });
});

describe("parseQueryResponse/mapGatewayStatus(§2.5)", () => {
  it("OD/WP/CD 映射 paid/unpaid/refunded;未知状态拒绝静默", () => {
    expect(mapGatewayStatus("OD")).toBe("paid");
    expect(mapGatewayStatus("WP")).toBe("unpaid");
    expect(mapGatewayStatus("CD")).toBe("refunded");
    expect(() => mapGatewayStatus("XX")).toThrow(/未知状态/);
  });

  it("errcode=0 取 data 流水字段;errcode≠0 上抛", () => {
    expect(
      parseQueryResponse({
        errcode: "0",
        errmsg: "成功",
        data: { status: "OD", transaction_id: "wx1", open_order_id: "o1" },
      }),
    ).toMatchObject({ status: "paid", transactionId: "wx1", openOrderId: "o1" });
    expect(() => parseQueryResponse({ errcode: "40029", errmsg: "错误的签名!" })).toThrow(
      /40029|签名/,
    );
  });
});

describe("XunhuGateway.verifyNotify(§2.3 回调)", () => {
  it("合法签名通过并抽出业务字段;坏签 valid=false(不抛,交业务层拒)", () => {
    const gw = new XunhuGateway(CFG);
    const payload: Record<string, string> = {
      status: "OD",
      trade_order_id: INPUT.orderNo,
      total_fee: "5.00",
      transaction_id: "wx_txn_1",
      open_order_id: "open_1",
      appid: CFG.appId,
      time: "1728461234",
      nonce_str: "abcdef1234567890",
      attach: "",
    };
    payload.hash = makeSign(payload, CFG.appSecret);
    expect(gw.verifyNotify(payload)).toEqual({
      valid: true,
      status: "OD",
      orderNo: INPUT.orderNo,
      totalFee: "5.00",
      transactionId: "wx_txn_1",
      openOrderId: "open_1",
    });

    const forged = { ...payload, total_fee: "0.01" };
    expect(gw.verifyNotify(forged).valid).toBe(false);
    expect(gw.verifyNotify({ status: "OD" }).valid).toBe(false);
  });
});
