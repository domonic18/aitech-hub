/**
 * Cookie 池单测:AES-256-GCM roundtrip、导入校验(ttwid 防呆)、脱敏视图。
 * env 经 vi.mock 注入固定 AUTH_SECRET(密钥箱主密钥派生源,不触真实 .env)。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({ env: { AUTH_SECRET: "unit-test-auth-secret-0123456789" } }));

import {
  decryptJars,
  encryptJars,
  CookiePoolError,
  maskJars,
  mergeImportedJar,
  parseCookiePairs,
} from "./cookies";

const JAR_A = `ttwid=aaa-bbb; sessionid=s1; msToken=m1`;
const JAR_B = `ttwid=ccc-ddd; sessionid=s2; msToken=m2; ssid=s2`;

describe("AES-256-GCM roundtrip", () => {
  it("加密后可解密还原,随机 iv 使密文不可预测", () => {
    const jars = [JAR_A, JAR_B];
    const c1 = encryptJars(jars);
    const c2 = encryptJars(jars);
    expect(c1).not.toBe(c2); // iv 随机
    expect(decryptJars(c1)).toEqual(jars);
    expect(decryptJars(c2)).toEqual(jars);
  });

  it("密钥不符/密文损坏 → 空池(不阻塞,等重新导入)", () => {
    expect(decryptJars("not-base64!!!")).toEqual([]);
    expect(decryptJars(Buffer.alloc(32, 1).toString("base64"))).toEqual([]); // GCM tag 校验失败
    const blob = Buffer.from(encryptJars([JAR_A]), "base64");
    blob[blob.length - 1] ^= 0xff; // 翻转密文末字节 → tag 校验失败
    expect(decryptJars(blob.toString("base64"))).toEqual([]);
    expect(decryptJars(null)).toEqual([]);
    expect(decryptJars("")).toEqual([]);
  });
});

describe("parseCookiePairs", () => {
  it("值含 = 保留首段后全部;空段/无 = 段跳过", () => {
    expect(parseCookiePairs("a=1; bad; =x; b = 2; c=pad=ded")).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", "pad=ded"],
    ]);
  });
});

describe("mergeImportedJar 导入校验", () => {
  it("少于 3 组键值对拒收(薄 jar 对 ttwid-only 返回 200 空)", () => {
    expect(() => mergeImportedJar([], "ttwid=only")).toThrow(CookiePoolError);
    expect(() => mergeImportedJar([], "ttwid=only; a=1")).toThrow(CookiePoolError);
  });

  it("缺 ttwid 拒收", () => {
    expect(() => mergeImportedJar([], "a=1; b=2; c=3")).toThrow(/ttwid/);
  });

  it("同 ttwid 覆盖旧值,不同 ttwid 追加", () => {
    const newer = `ttwid=aaa-bbb; sessionid=s1-new; msToken=m1-new`;
    const merged = mergeImportedJar([JAR_A, JAR_B], newer);
    expect(merged).toEqual([JAR_B, newer]); // 旧 aaa-bbb 被替换,ccc-ddd 保留
  });
});

describe("maskJars 脱敏", () => {
  it("只出 ttwid 前 8 位,无 ttwid 空串", () => {
    expect(maskJars([JAR_A, JAR_B])).toEqual([
      { ttwidPrefix: "aaa-bbb" },
      { ttwidPrefix: "ccc-ddd" },
    ]);
    expect(maskJars(["sessionid=x; other=y"])).toEqual([{ ttwidPrefix: "" }]);
  });
});
