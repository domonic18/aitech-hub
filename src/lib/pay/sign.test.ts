/**
 * 签名纯函数单测(M21 批②,提案 §9「签名生成/验签(自造向量+官方样例)」):
 * 向量用哑密钥离线算得并硬编码(真实商户密钥绝不入测试/git);钉死算法
 * 关键分支——空值与 hash 自身剔除、ASCII 字典序、secret 无连接符直拼、
 * 常量时间验签、篡改/缺签全拒。
 */
import { describe, expect, it } from "vitest";

import { makeSign, verifySign } from "@/lib/pay/sign";

const SECRET = "0123456789abcdef0123456789abcdef";

// 向量 1:仿统一下单全参数(哑密钥,离线 node:crypto 算得)
const CREATE_PARAMS = {
  appid: "1234567890",
  trade_order_id: "2026041219470504845M21",
  total_fee: "5.00",
  title: "测试文章解锁",
  time: "1728461234",
  nonce_str: "abcdef1234567890",
  type: "WAP",
  notify_url: "https://17aitech.com/api/pay/notify",
};

describe("makeSign(提案 §2.4,与 wxpay-xunhu.php#makeSign 逐行一致)", () => {
  it("全参数向量", () => {
    expect(makeSign(CREATE_PARAMS, SECRET)).toBe("49a5c1536aa4e76269aa69428ed75b10");
  });

  it("空值参数与 hash 自身不参与签名(向量含 attach 空串)", () => {
    // = sign({status,trade_order_id,total_fee,appid,time,nonce_str}, "sec"),attach:"" 被剔除
    expect(
      makeSign(
        {
          status: "OD",
          trade_order_id: "ORD1",
          total_fee: "0.01",
          appid: "a",
          time: "1",
          nonce_str: "n",
          attach: "",
        },
        "sec",
      ),
    ).toBe("e7077329cbdcb882cafadf670881e173");
    expect(
      makeSign(
        {
          status: "OD",
          trade_order_id: "ORD1",
          total_fee: "0.01",
          appid: "a",
          time: "1",
          nonce_str: "n",
          attach: "",
          hash: "00000000000000000000000000000000",
        },
        "sec",
      ),
    ).toBe("e7077329cbdcb882cafadf670881e173");
  });

  it("参数名 ASCII 字典序排序(b 在 a 后)", () => {
    expect(makeSign({ b: "2", a: "1" }, "k")).toBe("c45fc3946a90e0fc4882321347aee757");
  });

  it("secret 无连接符直拼在末尾(去掉 secret 则向量必然不同)", () => {
    expect(makeSign({ a: "1" }, "s")).not.toBe(makeSign({ a: "1s" }, "")); // "a=1&s" ≠ "a=1s&" 的截断歧义对照
    expect(makeSign({ a: "1" }, "s")).toBe(makeSign({ a: "1" }, "s")); // 确定性
  });
});

describe("verifySign(常量时间比较)", () => {
  it("正确 hash 通过;篡改/缺签/错长度/错密钥全拒", () => {
    const signed = { ...CREATE_PARAMS, hash: makeSign(CREATE_PARAMS, SECRET) };
    expect(verifySign(signed, SECRET)).toBe(true);

    expect(verifySign({ ...signed, total_fee: "0.01" }, SECRET)).toBe(false); // 金额篡改
    expect(verifySign({ ...signed, hash: "f".repeat(32) }, SECRET)).toBe(false); // hash 篡改
    const { hash: _drop, ...unsigned } = signed;
    expect(verifySign(unsigned, SECRET)).toBe(false); // 缺签
    expect(verifySign({ ...signed, hash: "short" }, SECRET)).toBe(false); // 长度不符(不给 timingSafeEqual 抛错面)
    expect(verifySign(signed, "ffffffffffffffffffffffffffffffff")).toBe(false); // 错密钥
  });
});
