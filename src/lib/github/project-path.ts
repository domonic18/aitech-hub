/**
 * 项目 URL 形态唯一构造点(M11,`/projects/<slug>/`):
 * - slug 是唯一解析键(登记时由仓库名派生、此后冻结),无 id 锚点 →
 *   错 slug 直接 404,**不做 308 归一**(与 /post/id-slug 不同,这里没有第二解析维度)。
 * 纯函数零 IO;全站项目链接只许经 projectPath 构造(同 post-path 纪律)。
 */
export const PROJECTS_BASE = "/projects";

/** canonical 详情路径(trailingSlash 红线:始终带尾斜杠) */
export function projectPath(slug: string): string {
  return `${PROJECTS_BASE}/${slug}/`;
}

/** URL 段是否为合法项目 slug 形态(详情路由守卫用,与派生产物同构) */
export function isProjectSlug(segment: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(segment);
}
