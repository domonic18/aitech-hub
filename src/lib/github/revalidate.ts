/**
 * GitHub 项目展示缓存面失效(M11 批②,镜像 content/revalidate.ts):
 * 仅 admin 写侧(web 进程)调用——worker 侧同步新鲜度走 ISR 600s 窗口,
 * 不做跨进程 revalidate(revalidatePath 只作用于本进程缓存,arch/05 §1)。
 */
import { revalidatePath } from "next/cache";

import { PROJECTS_BASE, projectPath } from "./project-path";

/**
 * 项目涉及的全部缓存面:详情(slug 为 null 时跳过,如登记/全量场景)+
 * 列表 + 首页 rail + sitemap + llms.txt。
 */
export function revalidateProjectPaths(slug: string | null): void {
  if (slug) revalidatePath(projectPath(slug));
  revalidatePath(`${PROJECTS_BASE}/`);
  revalidatePath("/");
  // sitemap/llms 是 Route Handler·Metadata Route(ISR):默认 "page" 型打不中其
  // `_N_T_/<path>/route` 内部 tag(e2e 实证缓存不动),"layout" 型命中的
  // `_N_T_/<path>/layout` 在其 tag 列表内,能即时失效
  revalidatePath("/sitemap.xml", "layout");
  revalidatePath("/llms.txt", "layout");
}
