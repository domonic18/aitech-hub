/**
 * 日对账单单比对口径单测(M21 批④):不一致原因枚举;网关响应缺流水字段
 * 不作不等证据(查询口径缺失≠对不上,§5.2 只告警不动账)。
 */
import { describe, expect, it } from "vitest";

import { findAuditMismatch } from "@/lib/pay/reconcile";

const PAID = { status: "paid" as const, raw: {} };

describe("findAuditMismatch(M21 日对账口径)", () => {
  it("一致:paid + 流水相同 → null", () => {
    expect(findAuditMismatch("txn1", { ...PAID, transactionId: "txn1" })).toBeNull();
  });

  it("网关非 paid 一律不一致(本地 paid 网关 unpaid/refunded)", () => {
    expect(findAuditMismatch("txn1", { ...PAID, status: "refunded" })).toBe(
      "gateway_status_refunded",
    );
    expect(findAuditMismatch("txn1", { ...PAID, status: "unpaid" })).toBe("gateway_status_unpaid");
  });

  it("本地流水锚缺失 → local_txn_missing", () => {
    expect(findAuditMismatch(null, PAID)).toBe("local_txn_missing");
  });

  it("流水不同 → transaction_id_differs", () => {
    expect(findAuditMismatch("txn1", { ...PAID, transactionId: "txn2" })).toBe(
      "transaction_id_differs",
    );
  });

  it("网关响应缺流水字段不作不等证据", () => {
    expect(findAuditMismatch("txn1", PAID)).toBeNull();
  });
});
