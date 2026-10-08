/**
 * 按需失效编排(arch/07-frontend §1):文章保存(publish/update)后由 post service 调用。
 * 单体红利:同进程直调 revalidatePath,无需 HTTP 内部调用。
 * service 层之上才允许出现 revalidatePath(arch/05-services §1),故独立成文件供写侧编排引用。
 * 2026-10 URL 终态:详情缓存面 = /post/<id>-<slug>/(id 锚定;slug 变更时新旧两个面都失效)。
 */
import { revalidatePath } from "next/cache";

import { postPath } from "./post-path";

/** 需失效的文章引用(id 锚定;slug 为变更前/后形态) */
export interface RevalidatePostRef {
  id: bigint;
  slug: string | null;
}

/** 单篇文章涉及的全部缓存面:详情 + .md 直出 + 首页 + 列表族 + 归档 + sitemap */
export function revalidatePostPaths(post: RevalidatePostRef): void {
  const detail = postPath(post.id, post.slug);
  revalidatePath(detail);
  revalidatePath(`${detail.replace(/\/$/, "")}.md`);
  revalidatePath("/");
  revalidatePath("/articles/");
  revalidatePath("/articles/page/[page]", "page");
  revalidatePath("/archive/");
  // sitemap 是 Metadata Route(ISR):默认 "page" 型打不中其内部 route tag,
  // "layout" 型命中的 `_N_T_/sitemap.xml/layout` 在其 tag 列表内(2026-10-05 e2e 实证)
  revalidatePath("/sitemap.xml", "layout");
}
