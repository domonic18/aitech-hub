/**
 * 文章分类管理区块(验收二批①:自独立页 /admin/categories 并入文章管理
 * 「分类」页签):台账 + 新增弹窗;排序小的在前,slug 建后不可改(公开页
 * /category/<slug>/ 以其锚定),删除守卫与缓存失效在 lib/content/categories-admin。
 */
import CategoriesAdminApp from "@/components/admin/categories/CategoriesAdminApp";
import CategoryDialog from "@/components/admin/categories/CategoryDialog";
import { listCategoriesAdmin } from "@/lib/content/categories-admin";

export default async function CategoriesSection(): Promise<React.ReactElement> {
  const items = await listCategoriesAdmin();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-3">
        管理文章编辑器与站点导航的分类下拉:排序小的在前;slug 建后不可改(公开页
        /category/&lt;slug&gt;/ 以其锚定);删除前需先将引用文章移走,且至少保留一个分类。
      </p>
      <div className="flex justify-end">
        <CategoryDialog label="+ 新增分类" />
      </div>
      <CategoriesAdminApp items={items} />
    </div>
  );
}
