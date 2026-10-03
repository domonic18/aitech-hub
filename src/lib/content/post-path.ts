/**
 * 文章 URL 形态唯一构造/解析点(2026-10 M6 URL 终态:`/post/<id>-<slug>/` 混合形态):
 * - **id 是唯一解析锚**(BigInt 主键):任何 `/post/<id>-随便什么/` 都命中该文章,由路由层
 *   对比 canonical 段后 308 归一——slug 可改、可空,永不毁外链(历史债务一次出清)。
 * - slug 是纯装饰(ASCII,可空):空 → canonical 为 `/post/<id>/`。
 * - 旧单段 `/%encoded%/` 由 legacy_url_map 301 承接(103 篇随迁落表,见 20261004 迁移)。
 * 纯函数零 IO,单测 post-path.test.ts 钉死;全站文章链接只许经 postPath 构造。
 */
export const POST_PATH_PREFIX = "/post";

/** ASCII slug 形态:小写字母数字 + 单连字符分隔(与 postSlugSchema 归一产物同构) */
const ASCII_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** 派生 slug 长度上限(token 边界截断,POST_LIMITS.slug=255 之内) */
export const MAX_ASCII_SLUG = 80;

export function isAsciiSlug(s: string): boolean {
  return ASCII_SLUG_RE.test(s);
}

/** canonical 路径段:id 起头 + 可选装饰 slug(156-agent-ceping / 58) */
export function postPathSegment(id: bigint, slug: string | null): string {
  return slug ? `${id}-${slug}` : `${id}`;
}

/** canonical 详情路径(trailingSlash 红线:始终带尾斜杠) */
export function postPath(id: bigint, slug: string | null): string {
  return `${POST_PATH_PREFIX}/${postPathSegment(id, slug)}/`;
}

export interface ParsedPostSegment {
  id: bigint;
  /** URL 里携带的装饰 slug(可能非 canonical,归一由路由层对比后 308) */
  slug: string | null;
}

/**
 * 解析 URL 段 → id。只认 `<digits>[-anything]` 形态,其余 → null(调用方 404);
 * 尾巴不校验——非 canonical 形态依赖路由层 canonical 对比归一,解析永远成功于 id。
 */
export function parsePostSegment(segment: string): ParsedPostSegment | null {
  const m = /^(\d+)(?:-([\s\S]*))?$/.exec(segment);
  if (!m) return null;
  return { id: BigInt(m[1]), slug: m[2] ? m[2] : null };
}

/**
 * 标题 → ASCII slug 派生(新建/迁移共用的唯一实现):
 * 标题内 [a-z0-9]+ 连续段小写化依序连接;连续重复 token 去重(mcp-mcp → mcp);
 * 超 MAX_ASCII_SLUG 在 token 边界截断;零 token(纯中文标题)→ null(bare-id URL)。
 */
export function asciiSlugFromTitle(title: string): string | null {
  const tokens = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const parts: string[] = [];
  let len = 0;
  for (const t of tokens) {
    if (parts[parts.length - 1] === t) continue;
    const add = parts.length === 0 ? t.length : t.length + 1;
    if (len + add > MAX_ASCII_SLUG) break;
    parts.push(t);
    len += add;
  }
  return parts.length > 0 ? parts.join("-") : null;
}

/** 派生结果冲突时的候选后缀:-2…-9(与写侧 createPost 的派生冲突策略共用) */
export function asciiSlugCandidates(base: string): string[] {
  return [base, ...Array.from({ length: 8 }, (_, i) => `${base}-${i + 2}`)];
}
