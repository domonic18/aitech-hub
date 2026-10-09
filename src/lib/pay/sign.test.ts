/**
 * 签名纯函数单测(M21 批②,提案 §9「签名生成/验签(自造向量+官方样例)」;
 * 2026-10-09 线上实证修订:基数去尾 & 后全量向量重算):
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

describe("makeSign(提案 §2.4;2026-10-09 网关实证:基数去尾 &)", () => {
  it("全参数向量", () => {
    expect(makeSign(CREATE_PARAMS, SECRET)).toBe("70e7612aed201079ecd54706bb049ff8");
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
    ).toBe("3fa46fdd0986a7817e185b68ff44acc1");
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
    ).toBe("3fa46fdd0986a7817e185b68ff44acc1");
  });

  it("参数名 ASCII 字典序排序(b 在 a 后)", () => {
    expect(makeSign({ b: "2", a: "1" }, "k")).toBe("af97cb1e07cd9f9f1279e0bae215015d");
  });

  it("secret 无连接符直拼在末尾(换 secret 必换签;确定性)", () => {
    expect(makeSign({ a: "1" }, "s")).toBe("acd5f557e3b8da52b8aaec0623d7725e");
    expect(makeSign({ a: "1" }, "s")).not.toBe(makeSign({ a: "1" }, "t"));
    expect(makeSign({ a: "1" }, "s")).toBe(makeSign({ a: "1" }, "s")); // 确定性
  });
});

describe("verifySign(常量时间比较)", () => {
  it("正确 hash 通过;篡改/缺签/错长度/错密钥全拒", () => {
    const signed = { ...CREATE_PARAMS, hash: makeSign(CREATE_PARAMS, SECRET) };
    expect(verifySign(signed, SECRET)).toBe(true);

    expect(verifySign({ ...signed, total_fee: "0.01" }, SECRET)).toBe(false); // 金额篡改
    expect(verifySign({ ...signed, hash: "f".repeat(32) }, SECRET)).toBe(false); // hash 篡改
    const unsigned: Record<string, string> = { ...signed };
    delete unsigned.hash;
    expect(verifySign(unsigned, SECRET)).toBe(false); // 缺签
    expect(verifySign({ ...signed, hash: "short" }, SECRET)).toBe(false); // 长度不符(不给 timingSafeEqual 抛错面)
    expect(verifySign(signed, "ffffffffffffffffffffffffffffffff")).toBe(false); // 错密钥
  });
});
