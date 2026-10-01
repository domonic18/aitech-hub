/** 新建文章(M5-a):编辑器空表单;分类来自 taxonomy 读侧(sortOrder 序)。
 * ?import=1(M5-b 一键发文):EditorTextarea mount 时消费 sessionStorage 交接稿。 */
import PostEditor from "@/components/admin/PostEditor";
import { listCategories } from "@/lib/content/taxonomy";

export const dynamic = "force-dynamic";

export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ import?: string }>;
}): Promise<React.ReactElement> {
  const [categories, sp] = await Promise.all([listCategories(), searchParams]);
  return (
    <PostEditor
      categories={categories.map((c) => ({ slug: c.slug, name: c.name }))}
      imported={sp.import === "1"}
    />
  );
}
