/**
 * Mock 网关单测(M21 批②):create/query/markPaid 状态、buildMockNotify
 * 签名回路(坏签/篡改全拒)——集成测试(批③ 全链路)以此为地基。
 */
import { describe, expect, it } from "vitest";

import { buildMockNotify, MockGateway } from "@/lib/pay/gateway/mock";

describe("MockGateway", () => {
  it("create → query 默认 unpaid;markPaid 后 paid(幂等返回 false)", async () => {
    const gw = new MockGateway();
    const created = await gw.create({
      orderNo: "ORD1",
      amount: "5.00",
      title: "t",
      notifyUrl: "http://x/api/pay/notify",
      returnUrl: "http://x/post/1",
    });
    expect(created.payUrl).toBe("mock://pay/ORD1");
    expect(await gw.query("ORD1")).toMatchObject({ status: "unpaid" });

    expect(gw.markPaid("ORD1")).toBe(true);
    expect(gw.markPaid("ORD1")).toBe(false);
    expect(await gw.query("ORD1")).toMatchObject({
      status: "paid",
      transactionId: "mock_txn_ORD1",
    });
  });

  it("buildMockNotify 验签通过;篡改金额/换密钥全拒", () => {
    const gw = new MockGateway();
    const notify = buildMockNotify("ORD1", "5.00");
    expect(gw.verifyNotify(notify)).toMatchObject({
      valid: true,
      status: "OD",
      orderNo: "ORD1",
      totalFee: "5.00",
    });

    expect(gw.verifyNotify({ ...notify, total_fee: "0.01" }).valid).toBe(false);
    expect(gw.verifyNotify({ ...notify, hash: "0".repeat(32) }).valid).toBe(false);
    expect(gw.verifyNotify(buildMockNotify("ORD1", "5.00", "CD")).status).toBe("CD");
  });
});
