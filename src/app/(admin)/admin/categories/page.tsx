/**
 * 文章分类管理页(2026-10-16 验收反馈:编辑器分类下拉此前不可编辑,后台增删改查)。
 * 下拉后续会扩展(如加图标/描述展示),故台账先行:slug 承载公开 URL 红线,
 * 删除守卫与缓存失效在 service/categories-admin。
 */
import CategoriesAdminApp from "@/components/admin/categories/CategoriesAdminApp";
import CategoryDialog from "@/components/admin/categories/CategoryDialog";
import { listCategoriesAdmin } from "@/lib/content/categories-admin";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const items = await listCategoriesAdmin();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">文章分类</h2>
        <p className="mt-0.5 text-xs text-text-3">
          管理文章编辑器与站点导航的分类下拉:排序小的在前;slug 建后不可改(公开页
          /category/&lt;slug&gt;/ 以其锚定);删除前需先将引用文章移走,且至少保留一个分类。
        </p>
      </div>
      <div className="flex justify-end">
        <CategoryDialog label="+ 新增分类" />
      </div>
      <CategoriesAdminApp items={items} />
    </div>
  );
}
