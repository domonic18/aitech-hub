/**
 * slug 归一化唯一入口(04 文档 §3 红线)。
 *
 * DB(wp 迁移与新文)统一存 percent-encoded 形态,且百分号十六进制为小写
 * (WordPress rawurlencode 口径,如 `2-pycharm%e5%ae%89...`)。路由层(App Router
 * params)拿到的是解码后的中文,迁移脚本拿到的可能已是编码形态——凡查 slug 必须
 * 先经本函数归一化,禁止直接用 params 查库。
 *
 * 此函数坏了 = 全站文章 404,单测见 src/lib/slug.test.ts,改动需谨慎。
 */

/** 循环解码上限:防御异常的超长二次编码链,3 轮足够覆盖真实场景 */
const MAX_DECODE_ROUNDS = 3;

/** 仅把 %XX 十六进制部分转小写(不动 slug 里的字面大写字母) */
function lowercasePercentEscapes(s: string): string {
  return s.replace(/%[0-9A-Fa-f]{2}/g, (m) => m.toLowerCase());
}

export function normalizeSlug(raw: string): string {
  if (!raw) return "";

  let decoded = raw;
  for (let i = 0; i < MAX_DECODE_ROUNDS; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      // 非法 % 序列(如裸 `%` 字面量):按原样停止解码,交由编码输出兜底
      break;
    }
    if (next === decoded) break;
    decoded = next;
  }

  return lowercasePercentEscapes(encodeURIComponent(decoded));
}
