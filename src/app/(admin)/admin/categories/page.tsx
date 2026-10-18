/**
 * 文章分类独立页已并入文章管理「分类」页签(验收二批①:?t=categories,
 * 侧栏一级项同步撤除——分类数量少,不占一级导航)。本页仅 308 承接旧书签/外链。
 */
import { permanentRedirect } from "next/navigation";

export default function AdminCategoriesPage(): never {
  permanentRedirect("/admin/posts/?t=categories");
}
