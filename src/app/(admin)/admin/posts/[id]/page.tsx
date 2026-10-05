/**
 * 编辑文章(M5-a):草稿/已发布进编辑器;
 * 旧文保真:WP 迁移纯 HTML 正文(contentHtml 且无 contentMd)只读视图,编辑器不挂载。
 */
import { notFound } from "next/navigation";

import PostEditor from "@/components/admin/PostEditor";
import ArticleBody from "@/components/article/ArticleBody";
import { asContentOrigin, postDisplayState } from "@/lib/content/post-schema";
import { getPostForAdmin, parsePostId } from "@/lib/content/posts-admin";
import { listCategories } from "@/lib/content/taxonomy";
import { formatCnDateTime } from "@/lib/datetime";
import { postPath } from "@/lib/content/post-path";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditPostPage({ params }: PageProps): Promise<React.ReactElement> {
  const { id: raw } = await params;
  const postId = parsePostId(raw);
  if (postId === null) notFound();
  const post = await getPostForAdmin(postId);
  if (!post) notFound();
  const categories = await listCategories();

  if (post.wpPostId !== null && !post.contentMd) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-line bg-panel-2 px-4 py-3 text-xs text-text-2">
          <svg className="ic mr-1 text-amber" aria-hidden="true">
            <use href="#i-warning" />
          </svg>
          <b className="text-text-1">旧文保真:</b>
          本文为 WP 迁移的历史文章(HTML 正文),后台只读;如需修改,请转 Markdown 重新发布 (原 URL
          不变,转 MD 工作流随后续迭代交付)。
        </div>
        <div className="rounded-md border border-line bg-panel p-6">
          <h1 className="text-xl font-bold">{post.title}</h1>
          <div className="mt-2 font-mono text-[11px] text-text-3">
            {postPath(post.id, post.slug)} · 发布{" "}
            {post.publishedAt ? formatCnDateTime(post.publishedAt) : "—"} · 分类{" "}
            {post.category.name}
          </div>
          <div className="mt-6">
            <ArticleBody contentMd={null} contentHtml={post.contentHtml} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <PostEditor
      categories={categories.map((c) => ({ slug: c.slug, name: c.name }))}
      post={{
        id: post.id.toString(),
        title: post.title,
        slug: post.slug,
        categorySlug: post.category.slug,
        tags: post.tags.map(({ tag }) => tag.name),
        contentMd: post.contentMd ?? "",
        excerpt: post.excerpt ?? "",
        coverPath: post.coverPath ?? "",
        seoTitle: post.seoTitle ?? "",
        seoDescription: post.seoDescription ?? "",
        contentOrigin: asContentOrigin(post.contentOrigin),
        status: postDisplayState(post),
      }}
    />
  );
}
