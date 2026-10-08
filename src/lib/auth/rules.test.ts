import { describe, expect, it } from "vitest";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PHONE_RE, validatePassword } from "./rules";

describe("PHONE_RE(11 位大陆手机号,登录/建号/脱敏共用)", () => {
  it.each(["13812341234", "19900000000", "17012345678"])("合法:%s", (phone) => {
    expect(PHONE_RE.test(phone)).toBe(true);
  });

  it.each([
    "12812341234", // 12x 段不存在
    "10812341234", // 10x 段不存在
    "1381234123", // 10 位
    "138123412341", // 12 位
    "1381234abc1", // 混入字母
    "", // 空串
  ])("非法:%s", (phone) => {
    expect(PHONE_RE.test(phone)).toBe(false);
  });
});

describe("validatePassword(≥8 位且同时含字母与数字;≤72 字节)", () => {
  it(`下边界 ${PASSWORD_MIN_LENGTH} 位通过`, () => {
    expect(validatePassword("abcd1234")).toBeNull();
  });

  it(`上边界 ${PASSWORD_MAX_LENGTH} 字符通过,超 1 位即拒(bcrypt 静默截断必须前置拦截)`, () => {
    const boundary = `${"a".repeat(PASSWORD_MAX_LENGTH - 1)}1`;
    expect(validatePassword(boundary)).toBeNull();
    expect(validatePassword(`${boundary}1`)).toMatch(/72/);
  });

  it("过短给明确文案", () => {
    expect(validatePassword("a1b2c1")).toMatch(/至少 8 位/);
  });

  it.each([
    "abcdefghij", // 纯字母
    "12345678", // 纯数字
    "一二三四五六七八1", // 无英文字母
  ])("缺字符类别:%s 拒绝", (pwd) => {
    expect(validatePassword(pwd)).toMatch(/字母与数字/);
  });

  it("大小写混合通过", () => {
    expect(validatePassword("AbCdEf12")).toBeNull();
  });
});
