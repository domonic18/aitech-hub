/**
 * 虎皮椒签名(M21 批②,提案 §2.4):下单/回调/下单响应同一套——取全部
 * 非空参数(排除 hash 与空值)按参数名 ASCII 字典序排序,`k=v&` 依次拼接
 * (末尾带 &),末尾直接拼 appsecret(无连接符),MD5 → 32 位小写。
 * 与生产源码 wxpay-xunhu.php#makeSign() 逐行一致(旧代码 1.5 年 33 单跑通
 * 同一算法;2026-10-08 线上 query.html 正/错签阴性对照亦验证)。验签常量
 * 时间比较防时序侧信道;secret 只参与签名,从不出现在上送参数/URL/日志。
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** 签名生成:调用方自行剔除不该参与签名的内部字段后再传入 */
export function makeSign(params: Record<string, string>, secret: string): string {
  const entries = Object.entries(params).filter(([k, v]) => k !== "hash" && v !== "");
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)); // 参数名 ASCII 字典序
  const base = entries.map(([k, v]) => `${k}=${v}&`).join("");
  return createHash("md5")
    .update(base + secret, "utf8")
    .digest("hex");
}

/** 验签:重算与收到 hash 常量时间比较;缺失/长度不符一律 false(不给枚举增量) */
export function verifySign(params: Record<string, string>, secret: string): boolean {
  const given = params.hash ?? "";
  if (given.length !== 32) return false;
  const expected = Buffer.from(makeSign(params, secret), "utf8");
  return timingSafeEqual(Buffer.from(given, "utf8"), expected);
}
