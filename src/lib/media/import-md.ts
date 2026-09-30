/**
 * 一键发文 · Markdown 图片引用解析与替换(M5-b;原型 admin-editor 一键发文弹窗)。
 * 纯函数、无 Node 依赖:浏览器(导入弹窗)与服务端(单测)共用同一实现。
 *
 * 状态流(arch/08-media §2 / arch/05-services §4.2):
 * 选 md → 解析图片引用(本地匹配所选文件 / 外链交 media.transfer 转存)
 * → 上传入库(sha1 去重)→ 引用替换为站内 URL → 进入编辑器。
 */

/** 一张图片引用的解析结果 */
export interface MdImageRef {
  /** 原始引用文本(替换时按此精确匹配) */
  raw: string;
  /** 引用目标(未解码;站内相对路径或完整外链) */
  src: string;
  /** 外链(http/https 绝对地址且非站内路径)→ 走 media.transfer */
  external: boolean;
}

/** 一键发文弹窗 → 编辑器的 sessionStorage 交接键(写读双方共用,勿散落硬编码) */
export const IMPORT_MD_STORE_KEY = "ah:import-md";

/** 站内路径形态(替换只认它;以 `/` 开头的引用视为站内资产) */
function isExternalSrc(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/** 解析 Markdown 全部图片引用(md 图片语法 + 旧文风格内联 HTML img),按 src 去重 */
export function extractImageRefs(md: string): MdImageRef[] {
  const seen = new Set<string>();
  const out: MdImageRef[] = [];
  const push = (src: string): void => {
    const trimmed = src.trim();
    if (!trimmed || trimmed.startsWith("data:")) return; // 内联 base64 不处理
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push({ raw: trimmed, src: trimmed, external: isExternalSrc(trimmed) });
  };
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) push(m[1]);
  for (const m of md.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/gi)) push(m[1]);
  for (const m of md.matchAll(/<img\b[^>]*?\bsrc='([^']+)'/gi)) push(m[1]);
  return out;
}

/** 引用替换后的目标(转存/上传失败保留原链,弹窗给出失败清单) */
export type ImportMapping = Record</* 原始 src */ string, string | null>;

/**
 * 把 md 中图片引用替换为站内 URL:
 * - md 图片语法与 HTML img 双语法同 src 一起替换;
 * - mapping[src] 为 null(失败)或缺失(本地文件未选中)时保留原链;
 * - 只替换图片引用位置的 src 本体,不动正文其他文本。
 */
export function replaceImageRefs(md: string, mapping: ImportMapping): string {
  let result = md;
  for (const [src, target] of Object.entries(mapping)) {
    if (!target) continue;
    // 先替换 HTML img(属性值边界明确),再替换 md 语法括号引用
    result = result.split(`src="${src}"`).join(`src="${target}"`);
    result = result.split(`src='${src}'`).join(`src='${target}'`);
    result = result.split(`](${src})`).join(`](${target})`);
  }
  return result;
}

/** 引用路径的文件名(解码后),用于与用户所选本地文件按名匹配 */
export function refBasename(src: string): string {
  const last = src.split(/[\\/]/).pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** 导入结果汇总(弹窗完成态;原型:完成 N/M · 新建 x · 复用 y · 转存 z · 失败 w) */
export function summarizeImport(mapping: ImportMapping): {
  total: number;
  replaced: number;
  failed: string[];
} {
  const entries = Object.entries(mapping);
  const failed = entries.filter(([, t]) => !t).map(([src]) => src);
  return { total: entries.length, replaced: entries.length - failed.length, failed };
}
