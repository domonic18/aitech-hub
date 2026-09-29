import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import ArticleBody from "@/components/article/ArticleBody";
import { excerptOf } from "@/lib/content/format";
import { legacyRedirectOrNotFound } from "@/lib/content/legacy";
import { getPostBySlug, listPostSlugsForPrerender } from "@/lib/content/posts";
import { formatCnDate } from "@/lib/datetime";
import { absoluteUrl } from "@/lib/seo/site";
import { normalizeSlug } from "@/lib/slug";

/**
 * 文章详情(04 文档 §1/§2):ISR + 按需 revalidate(M5 保存时直调);
 * generateStaticParams 返回 DB 原始(编码形态)slug,构建期全量预渲染。
 */
export const revalidate = 600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return (await listPostSlugsForPrerender()).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};
  const title = post.seoTitle || post.title;
  const description = post.seoDescription || excerptOf(post);
  return {
    title,
    description,
    alternates: { canonical: `/${post.slug}/` },
    openGraph: {
      type: "article",
      title,
      description,
      url: absoluteUrl(`/${post.slug}/`),
      siteName: "一起AI技术",
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      images: post.coverPath ? [{ url: absoluteUrl(post.coverPath) }] : undefined,
    },
  };
}

export default async function ArticlePage({ params }: PageProps): Promise<React.ReactElement> {
  const { slug } = await params;
  const normalized = normalizeSlug(slug);
  const post = await getPostBySlug(normalized);
  // 先新站路由、后映射表(04 文档 §6):未命中文章走 legacy 永久重定向,再 404
  if (!post) {
    await legacyRedirectOrNotFound([slug]); // 必抛(redirect/notFound)
    notFound();
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: { "@type": "Person", name: "domonic18", url: "https://github.com/domonic18" },
    publisher: { "@type": "Person", name: "domonic18" },
    mainEntityOfPage: absoluteUrl(`/${post.slug}/`),
    image: post.coverPath ? absoluteUrl(post.coverPath) : undefined,
  };

  return (
    <article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header>
        <h1 className="text-2xl font-bold leading-snug sm:text-3xl">{post.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
          {post.publishedAt ? (
            <time dateTime={post.publishedAt.toISOString()}>{formatCnDate(post.publishedAt)}</time>
          ) : null}
          <Link href={`/category/${post.category.slug}/`} className="hover:text-neutral-800">
            {post.category.name}
          </Link>
          {post.tags.map(({ tag }) => (
            <Link key={tag.slug} href={`/tag/${tag.slug}/`} className="hover:text-neutral-800">
              #{tag.name}
            </Link>
          ))}
          <span>阅读 {post.viewsCount.toLocaleString("zh-CN")}</span>
        </div>
      </header>

      {post.coverPath ? (
        <div className="relative mt-6 aspect-[2.35/1] overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900">
          {/* /wp-content/** 由 Nginx 直接服务,不走 next/image 优化器(04 文档 §3;本地为 wp-content 路由兜底) */}
          <Image
            src={post.coverPath}
            alt={post.title}
            fill
            unoptimized
            priority
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 768px"
          />
        </div>
      ) : null}

      <div className="mt-8">
        <ArticleBody contentMd={post.contentMd} contentHtml={post.contentHtml} />
      </div>

      <footer className="mt-12 border-t border-neutral-200/60 pt-4 text-sm text-neutral-500">
        <Link href="/articles/" className="hover:text-neutral-800">
          ← 返回全部文章
        </Link>
      </footer>
    </article>
  );
}
