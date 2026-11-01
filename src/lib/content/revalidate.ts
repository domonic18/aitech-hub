/**
 * 按需失效编排(arch/07-frontend §1):文章保存(publish/update)后由 post service 调用。
 * 单体红利:同进程直调 revalidatePath,无需 HTTP 内部调用。
 * service 层之上才允许出现 revalidatePath(arch/05-services §1),故独立成文件供写侧编排引用。
 * 2026-10 URL 终态:详情缓存面 = /post/<id>-<slug>/(id 锚定;slug 变更时新旧两个面都失效)。
 */
import { revalidatePath } from "next/cache";

import { SEO_ROUTES } from "@/lib/seo/routes";

import { asciiSlugFromTitle, pinPath } from "./pin-path";
import { postPath } from "./post-path";

/**
 * 文章发布还会改变「不在 (site) 页面树下」的出口:feed.xml 与 llms 系列最长
 * 滞后一个 ISR 窗口(3600s)才见新文(issue #203)。robots 与内容无关,不进清单;
 * sitemap 同为 Route Handler/Metadata Route,单独在下方处理(带 layout 型注释)。
 * 清单本体取自 SEO_ROUTES,新增 SEO 出口不必回来改这里。
 */
const PUBLISH_SEO_ROUTES = SEO_ROUTES.filter(
  (path) => path !== "/robots.txt" && path !== "/sitemap.xml",
);

/** 需失效的文章引用(id 锚定;slug 为变更前/后形态) */
export interface RevalidatePostRef {
  id: bigint;
  slug: string | null;
}

/** 单篇文章涉及的全部缓存面:详情 + .md 直出 + 首页 + 列表族 + 归档 + feed/llms + sitemap */
export function revalidatePostPaths(post: RevalidatePostRef): void {
  const detail = postPath(post.id, post.slug);
  revalidatePath(detail);
  revalidatePath(`${detail.replace(/\/$/, "")}.md`);
  revalidatePath("/");
  revalidatePath("/articles/");
  revalidatePath("/articles/page/[page]", "page");
  revalidatePath("/archive/");
  for (const path of PUBLISH_SEO_ROUTES) revalidatePath(path, "layout");
  // sitemap 是 Metadata Route(ISR):默认 "page" 型打不中其内部 route tag,
  // "layout" 型命中的 `_N_T_/sitemap.xml/layout` 在其 tag 列表内(2026-10-05 e2e 实证)
  revalidatePath("/sitemap.xml", "layout");
}

/** 贴图写侧失效面(2026-11-01 列表页重构):贴图混入 /articles 时间流后,
 * 上架/下架/改标题(装饰 slug 变)必须同时失效详情、/pins/、/articles 列表族与
 * sitemap;此前只能等 ISR 600s 兜底。slug 由标题派生,与详情页同口径。 */
export interface RevalidatePinRef {
  id: bigint;
  title: string;
}

export function revalidatePinPaths(pin: RevalidatePinRef): void {
  revalidatePath(pinPath(pin.id, asciiSlugFromTitle(pin.title)));
  revalidatePath("/pins/");
  revalidatePath("/articles/");
  revalidatePath("/articles/page/[page]", "page");
  revalidatePath("/sitemap.xml", "layout");
}

/** 分类写侧失效面(2026-10-16 后台增删改查):分类页 + 首页 + sitemap。
 * slug 建后不可改(URL 红线),故无新旧 slug 对;新建分类的 /category/<slug>/
 * 首次访问按需 ISR,无需预失效。 */
export function revalidateCategoryPaths(slug: string): void {
  revalidatePath(`/category/${slug}/`);
  revalidatePath("/");
  revalidatePath("/sitemap.xml", "layout");
}
