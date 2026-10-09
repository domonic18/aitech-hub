/**
 * 虎皮椒签名(M21 批②,提案 §2.4;2026-10-09 线上实证修订):下单/回调/
 * 下单响应同一套——取全部非空参数(排除 hash 与空值)按参数名 ASCII 字典序
 * 排序,`k=v&` 依次拼接后**去掉末尾 &**,末尾直接拼 appsecret(无连接符),
 * MD5 → 32 位小写。
 * ⚠️ 2026-10-09 生产排障实证:虎皮椒网关已改版,签名基数末尾不再带 `&`
 * (旧 wxpay-xunhu.php 的尾 & 形态返回 40029"错误的签名";去尾后 query.html
 * 即过签、do.html 成功出码)。响应 hash 同格式且覆盖全部平铺字段(含
 * errcode/errmsg,2026-10-09 ¥1 真实下单响应复算命中)。验签常量时间比较
 * 防时序侧信道;secret 只参与签名,从不出现在上送参数/URL/日志。
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** 签名生成:调用方自行剔除不该参与签名的内部字段后再传入 */
export function makeSign(params: Record<string, string>, secret: string): string {
  const entries = Object.entries(params).filter(([k, v]) => k !== "hash" && v !== "");
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)); // 参数名 ASCII 字典序
  const base = entries
    .map(([k, v]) => `${k}=${v}&`)
    .join("")
    .replace(/&$/, ""); // 网关 2026-10-09 实证:基数末尾不带 &(带 & 即 40029)
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
