/**
 * 贴图 URL 形态唯一构造/解析点(M41 渠道三:`/pins/<id>-<slug>/` 混合形态,
 * 循 post-path 同款 id 锚定纪律):
 * - **id 是唯一解析锚**(BigInt 主键):任何 `/pins/<id>-随便什么/` 都命中该贴图,
 *   由路由层对比 canonical 段后 308 归一——slug 可改、可空,永不毁外链。
 * - slug 是纯装饰(ASCII,可空):空 → canonical 为 `/pins/<id>/`。
 * 纯函数零 IO,单测 pin-path.test.ts 钉死;全站贴图链接只许经 pinPath 构造。
 */
import { asciiSlugFromTitle } from "./post-path";

export const PIN_PATH_PREFIX = "/pins";

/** canonical 路径段:id 起头 + 可选装饰 slug */
export function pinPathSegment(id: bigint, slug: string | null): string {
  return slug ? `${id}-${slug}` : `${id}`;
}

/** canonical 详情路径(trailingSlash 红线:始终带尾斜杠,同 postPath) */
export function pinPath(id: bigint, slug: string | null): string {
  return `${PIN_PATH_PREFIX}/${pinPathSegment(id, slug)}/`;
}

export interface ParsedPinSegment {
  id: bigint;
  /** URL 里携带的装饰 slug(可能非 canonical,归一由路由层对比后 308) */
  slug: string | null;
}

/**
 * 解析 URL 段 → id。只认 `<digits>[-anything]` 形态,其余 → null(调用方 404);
 * 尾巴不校验——非 canonical 形态依赖路由层 canonical 对比归一,解析永远成功于 id。
 */
export function parsePinSegment(segment: string): ParsedPinSegment | null {
  const m = /^(\d+)(?:-([\s\S]*))?$/.exec(segment);
  if (!m) return null;
  return { id: BigInt(m[1]), slug: m[2] ? m[2] : null };
}

/** 标题 → ASCII slug 派生(与文章同款实现,直接复用 post-path 唯一实现) */
export { asciiSlugFromTitle };
