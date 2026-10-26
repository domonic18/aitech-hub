/**
 * Cookie 池(M8,arch/02 §2「加密落库」):AES-256-GCM 密文存 crawl_source
 * 平台行 config.cookieJars,真相源在 PG;网关零密钥(每次请求携明文 jar)。
 * 池是平台级(非博主级):多博主共享身份池,风控冷却态在网关内存。
 * 导入校验/脱敏规则 per-platform(M24):douyin=登录态 ttwid 刚需,
 * bilibili=游客 buvid3 即有效。加密经 ../crypto/secret-box(主密钥
 * AUTH_SECRET 派生,批⑥去 env 化)。展示永远脱敏;日志禁打 cookie 值。
 */
import { decryptSecret, encryptSecret } from "../crypto/secret-box";

import { VIDEO_PLATFORM_DOUYIN } from "./constants";

/** 平台行 config 中加密 jar 池的键名(crawl_source.config 契约,读写唯一出处) */
export const CONFIG_KEY_JARS = "cookieJars";

/** 平台 Cookie 导入规则(M24):关键 cookie + 薄 jar 防呆阈值 */
export interface PlatformCookieRule {
  /** 可用性判定关键 cookie:douyin=ttwid(Web 接口刚需,缺则 200 空响应);
   * bilibili=buvid3(游客设备指纹,访问过 B 站即有) */
  essentialKey: string;
  /** 最少键值对数:douyin=3(薄 jar 防呆,对齐参考实现实测);bilibili=1(游客即有效) */
  minPairs: number;
  /** 校验失败文案(导入弹窗回显) */
  minPairsHint: string;
  essentialHint: string;
}

/** 平台规则表;未收录平台回落 douyin 规则(保守防呆) */
export const PLATFORM_COOKIE_RULES: Record<string, PlatformCookieRule> = {
  douyin: {
    essentialKey: "ttwid",
    minPairs: 3,
    minPairsHint: "完整浏览器 Cookie",
    essentialHint: "须从已登录浏览器完整复制",
  },
  bilibili: {
    essentialKey: "buvid3",
    minPairs: 1,
    minPairsHint: "游客 Cookie 即可(登录态更稳)",
    essentialHint: "浏览器访问过 B 站即含 buvid3",
  },
};

export function platformCookieRule(platform: string): PlatformCookieRule {
  return PLATFORM_COOKIE_RULES[platform] ?? PLATFORM_COOKIE_RULES.douyin!;
}

export class CookiePoolError extends Error {}

/** 从平台行 config 取加密 jar 池(非对象/null 安全;读侧统一出口,禁再手写形状断言) */
export function jarsFromConfig(config: unknown): string[] {
  if (config == null || typeof config !== "object") return [];
  return decryptJars((config as Record<string, unknown>)[CONFIG_KEY_JARS]);
}

/** 加密 jar 池(JSON 数组 → AES-256-GCM;base64(iv|tag|ciphertext)) */
export function encryptJars(jars: string[]): string {
  return encryptSecret(JSON.stringify(jars));
}

/** 解密 jar 池;损坏/密钥轮换视为空池(不阻塞,等重新导入) */
export function decryptJars(payload: unknown): string[] {
  if (typeof payload !== "string" || payload.length === 0) return [];
  const plaintext = decryptSecret(payload);
  if (plaintext === null) return [];
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((j): j is string => typeof j === "string" && j.length > 0);
  } catch {
    return [];
  }
}

/** 解析 Cookie 串为键值对(值含 `=` 时保留首段后全部,与浏览器序列化口径一致) */
export function parseCookiePairs(cookie: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    pairs.push([trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim()]);
  }
  return pairs;
}

/**
 * 导入校验 per-platform:≥minPairs 键值对且含关键 cookie(薄 jar 防呆);
 * 通过后按关键 cookie 值去重并入现有池(同值 = 同身份,新值覆盖旧值)。
 * platform 缺省 douyin(旧调用兼容)。
 */
export function mergeImportedJar(
  existingJars: string[],
  imported: string,
  platform: string = VIDEO_PLATFORM_DOUYIN,
): string[] {
  const rule = platformCookieRule(platform);
  const pairs = parseCookiePairs(imported);
  if (pairs.length < rule.minPairs) {
    throw new CookiePoolError(`Cookie 至少含 ${rule.minPairs} 组键值对(${rule.minPairsHint})`);
  }
  if (!pairs.some(([name]) => name === rule.essentialKey)) {
    throw new CookiePoolError(`Cookie 缺少 ${rule.essentialKey}(${rule.essentialHint})`);
  }
  const importedKey = pairs.find(([name]) => name === rule.essentialKey)?.[1];
  const kept = existingJars.filter((jar) => {
    const key = parseCookiePairs(jar).find(([name]) => name === rule.essentialKey)?.[1];
    return key !== importedKey;
  });
  return [...kept, imported];
}

/** 脱敏视图 per-platform:数量 + 每份 jar 的关键 cookie 前 8 位(台账/状态卡用,禁出完整值) */
export function maskJars(
  jars: string[],
  platform: string = VIDEO_PLATFORM_DOUYIN,
): Array<{ essentialKey: string; essentialPrefix: string }> {
  const rule = platformCookieRule(platform);
  return jars.map((jar) => {
    const value = parseCookiePairs(jar).find(([name]) => name === rule.essentialKey)?.[1] ?? "";
    return { essentialKey: rule.essentialKey, essentialPrefix: value.slice(0, 8) };
  });
}

/** 清池:去掉 config.cookieJars 键(其余键保留);非对象返回 null */
export function clearJarsInConfig(config: unknown): Record<string, unknown> | null {
  if (config == null || typeof config !== "object") return null;
  const out = { ...(config as Record<string, unknown>) };
  delete out[CONFIG_KEY_JARS];
  return out;
}
