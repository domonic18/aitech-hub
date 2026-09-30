/**
 * 按需失效编排(arch/07-frontend §1):文章保存(publish/update)后由 post service 调用。
 *单体红利:同进程直调 revalidatePath,无需 HTTP 内部调用。
 * service 层之上才允许出现 revalidatePath(arch/05-services §1),故独立成文件供写侧编排引用。
 */
import { revalidatePath } from "next/cache";

/** 单篇文章涉及的全部缓存面:详情 + 首页 + 列表族 + 归档 + sitemap */
export function revalidatePostPaths(slug: string): void {
  revalidatePath(`/${slug}/`);
  revalidatePath(`/${slug}.md`);
  revalidatePath("/");
  revalidatePath("/articles/");
  revalidatePath("/articles/page/[page]", "page");
  revalidatePath("/archive/");
  revalidatePath("/sitemap.xml");
}
