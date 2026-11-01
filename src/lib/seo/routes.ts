/**
 * 全站 SEO 出口路由清单(单一来源)。
 *
 * 用途:内部失效端点(api/internal/revalidate)做全站刷新时,除 `(site)` 树外还要
 * 逐个 revalidatePath 这些「不在页面树下」的路由 —— sitemap/feed/llms 由专用
 * Route Handler 或元数据约定产出,`revalidatePath("/", "layout")` 覆盖不到。
 *
 * 此前这份数组直接写死在 route.ts 里,与实际路由文件各存一份,路由改名(比如把
 * feed.xml 换成 rss.xml)不会有任何报错,只会静默失效一个缓存面。routes.test.ts
 * 逐个核对下面 path 的源文件确实存在,改名时测试先红。
 *
 * 路径是 URL 形态(带前缀点号),不是文件路径;对应源文件见 SOURCE_OF。
 */
export const SEO_ROUTES = [
  "/sitemap.xml",
  "/feed.xml",
  "/llms.txt",
  "/llms-full.txt",
  "/robots.txt",
] as const;

export type SeoRoute = (typeof SEO_ROUTES)[number];

/** SEO 路由 → 期望存在的源文件(相对仓库根);仅供 routes.test.ts 防漂移用 */
export const SEO_ROUTE_SOURCES: Record<SeoRoute, string> = {
  "/sitemap.xml": "src/app/sitemap.ts",
  "/feed.xml": "src/app/feed.xml/route.ts",
  "/llms.txt": "src/app/llms.txt/route.ts",
  "/llms-full.txt": "src/app/llms-full.txt/route.ts",
  "/robots.txt": "src/app/robots.ts",
};
