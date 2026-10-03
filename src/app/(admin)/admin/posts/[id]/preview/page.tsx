/**
 * 文章查看页(M5-d 用户反馈:列表点击 = 查看,编辑走显式按钮):
 * 复用前台 ArticleBody 渲染链(md 优先,未回填旧文落 HTML),草稿/已发布/下架均可看。
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import PostStatusBadge from "@/components/admin/PostStatusBadge";
import ArticleBody from "@/components/article/ArticleBody";
import { postDisplayState } from "@/lib/content/post-schema";
import { getPostForAdmin, parsePostId } from "@/lib/content/posts-admin";
import { formatCnDateTime } from "@/lib/datetime";
import { postPath } from "@/lib/content/post-path";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PreviewPostPage({ params }: PageProps): Promise<React.ReactElement> {
  const { id: raw } = await params;
  const postId = parsePostId(raw);
  if (postId === null) notFound();
  const post = await getPostForAdmin(postId);
  if (!post) notFound();

  const backBtn =
    "inline-flex cursor-pointer items-center gap-1 rounded-sm border border-line bg-panel px-3 py-2 text-sm text-text-2 hover:border-line-hover hover:text-text-1";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/posts/" className={backBtn}>
          ← 返回列表
        </Link>
        <Link
          href={`/admin/posts/${post.id}`}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <svg className="ic" aria-hidden="true">
            <use href="#i-edit" />
          </svg>
          编辑
        </Link>
        <PostStatusBadge state={postDisplayState(post)} />
      </div>

      <article className="rounded-md border border-line bg-panel p-8">
        <h1 className="text-2xl font-bold leading-snug">{post.title}</h1>
        <div className="mt-2 font-mono text-[11px] text-text-3">
          {postPath(post.id, post.slug)} · 分类 {post.category.name} · 浏览{" "}
          {post.viewsCount.toLocaleString("en-US")} · 发布{" "}
          {post.publishedAt ? formatCnDateTime(post.publishedAt) : "—"}
        </div>
        <div className="mt-6">
          <ArticleBody contentMd={post.contentMd} contentHtml={post.contentHtml} />
        </div>
      </article>
    </div>
  );
}
