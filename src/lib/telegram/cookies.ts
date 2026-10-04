/**
 * 抖音 Cookie 池(M8,arch/02 §2「加密落库」):AES-256-GCM 密文存 crawl_source
 * 平台行 config.cookieJars,真相源在 PG;网关零密钥(每次请求携明文 jar)。
 * 池是平台级(非博主级):多博主共享身份池,风控冷却态在网关内存。
 * 加密经 ../crypto/secret-box(主密钥 AUTH_SECRET 派生,批⑥去 env 化)。
 * 展示永远脱敏;日志禁打 cookie 值。
 */
import { decryptSecret, encryptSecret } from "../crypto/secret-box";

/** 可用性判定关键 cookie:ttwid 是抖音 Web 接口刚需(缺它拿到 200 空响应) */
export const ESSENTIAL_COOKIE_KEY = "ttwid";
/** 薄 jar 防呆:作品接口对 ttwid-only 的 jar 返回 200 空,要求完整浏览器 Cookie */
export const MIN_COOKIE_PAIRS = 3;

export class CookiePoolError extends Error {}

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
 * 导入校验:≥3 键值对且含 ttwid(薄 jar 防呆,对齐参考实现实测结论);
 * 通过后按 ttwid 去重并入现有池(同 ttwid = 同身份,新值覆盖旧值)。
 */
export function mergeImportedJar(existingJars: string[], imported: string): string[] {
  const pairs = parseCookiePairs(imported);
  if (pairs.length < MIN_COOKIE_PAIRS) {
    throw new CookiePoolError(`Cookie 至少含 ${MIN_COOKIE_PAIRS} 组键值对(完整浏览器 Cookie)`);
  }
  if (!pairs.some(([name]) => name === ESSENTIAL_COOKIE_KEY)) {
    throw new CookiePoolError(`Cookie 缺少 ${ESSENTIAL_COOKIE_KEY}(须从已登录浏览器完整复制)`);
  }
  const importedTtwid = pairs.find(([name]) => name === ESSENTIAL_COOKIE_KEY)?.[1];
  const kept = existingJars.filter((jar) => {
    const ttwid = parseCookiePairs(jar).find(([name]) => name === ESSENTIAL_COOKIE_KEY)?.[1];
    return ttwid !== importedTtwid;
  });
  return [...kept, imported];
}

/** 脱敏视图:数量 + 每份 jar 的 ttwid 前 8 位(台账/状态卡用,禁出完整值) */
export function maskJars(jars: string[]): Array<{ ttwidPrefix: string }> {
  return jars.map((jar) => {
    const ttwid = parseCookiePairs(jar).find(([name]) => name === ESSENTIAL_COOKIE_KEY)?.[1] ?? "";
    return { ttwidPrefix: ttwid.slice(0, 8) };
  });
}

/** 清池:去掉 config.cookieJars 键(其余键保留);非对象返回 null */
export function clearJarsInConfig(config: unknown): Record<string, unknown> | null {
  if (config == null || typeof config !== "object") return null;
  const out = { ...(config as Record<string, unknown>) };
  delete out.cookieJars;
  return out;
}
