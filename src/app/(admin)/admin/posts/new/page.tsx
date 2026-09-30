/** 新建文章(M5-a):编辑器空表单;分类来自 taxonomy 读侧(sortOrder 序)。 */
import PostEditor from "@/components/admin/PostEditor";
import { listCategories } from "@/lib/content/taxonomy";

export const dynamic = "force-dynamic";

export default async function NewPostPage(): Promise<React.ReactElement> {
  const categories = await listCategories();
  return <PostEditor categories={categories.map((c) => ({ slug: c.slug, name: c.name }))} />;
}
