import { getSiteTitle } from "@/lib/config/site-config";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import ArticleBody from "@/components/article/ArticleBody";
import PayGateCard from "@/components/pay/PayGateCard";
import { excerptOf } from "@/lib/content/format";
import { getPostById, listPostSegmentsForPrerender } from "@/lib/content/posts";
import { parsePostSegment, postPath, postPathSegment } from "@/lib/content/post-path";
import {
  CONTENT_ORIGIN_BADGES,
  CONTENT_ORIGIN_LABELS,
  asContentOrigin,
} from "@/lib/content/post-schema";
import { formatCnDate } from "@/lib/datetime";
import { previewMarkdown } from "@/lib/pay/preview";
import { absoluteUrl } from "@/lib/seo/site";

/**
 * 文章详情(2026-10 URL 终态:/post/<id>-<slug>/ 混合形态,id 是唯一解析锚):
 * ISR + 按需 revalidate(M5 保存时直调);非 canonical 形态(/post/<id>/、错 slug、
 * 任意尾巴)308 归一到 canonical——slug 可改可空,外链永不毁。
 * generateStaticParams 返回 canonical 段(纯 ASCII,无编码问题)。
 */
export const revalidate = 600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return (await listPostSegmentsForPrerender()).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parsePostSegment(slug);
  const post = parsed ? await getPostById(parsed.id) : null;
  if (!post) return {};
  const title = post.seoTitle || post.title;
  const description = post.seoDescription || excerptOf(post);
  return {
    title,
    description,
    alternates: { canonical: postPath(post.id, post.slug) },
    openGraph: {
      type: "article",
      title,
      description,
      url: absoluteUrl(postPath(post.id, post.slug)),
      siteName: await getSiteTitle(),
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      images: post.coverPath ? [{ url: absoluteUrl(post.coverPath) }] : undefined,
    },
  };
}

export default async function ArticlePage({ params }: PageProps): Promise<React.ReactElement> {
  const { slug } = await params;
  const parsed = parsePostSegment(slug);
  const post = parsed ? await getPostById(parsed.id) : null;
  if (!post) notFound();
  // 创作方式标识(合规):human 恒空不渲染,AI 系挂徽章 + 悬浮完整文案
  const origin = asContentOrigin(post.contentOrigin);
  // 解析只认 id,URL 形态归一:非 canonical 段(含 bare-id、错 slug)永久重定向收敛信号
  const canonical = postPathSegment(post.id, post.slug);
  if (slug !== canonical) permanentRedirect(`/post/${canonical}/`);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: { "@type": "Person", name: "domonic18", url: "https://github.com/domonic18" },
    publisher: { "@type": "Person", name: "domonic18" },
    mainEntityOfPage: absoluteUrl(postPath(post.id, post.slug)),
    image: post.coverPath ? absoluteUrl(post.coverPath) : undefined,
    // 付费文章如实声明(M21):对爬虫与用户下发同一份截断预览,无 cloaking
    ...(post.isPurchasable
      ? {
          isAccessibleForFree: false,
          hasPart: { "@type": "WebPageElement", isAccessibleForFree: false, cssSelector: ".prose" },
        }
      : {}),
  };

  return (
    <article className="mx-auto w-full max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header>
        <h1 className="text-2xl font-bold leading-snug sm:text-3xl">{post.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
          {post.publishedAt ? (
            <time dateTime={post.publishedAt.toISOString()}>{formatCnDate(post.publishedAt)}</time>
          ) : null}
          <Link href={`/category/${post.category.slug}/`} className="hover:text-text-1">
            {post.category.name}
          </Link>
          {post.tags.map(({ tag }) => (
            <Link key={tag.slug} href={`/tag/${tag.slug}/`} className="hover:text-text-1">
              #{tag.name}
            </Link>
          ))}
          <span>阅读 {post.viewsCount.toLocaleString("zh-CN")}</span>
          {CONTENT_ORIGIN_BADGES[origin] ? (
            <span
              className="rounded-sm border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent"
              title={CONTENT_ORIGIN_LABELS[origin]}
            >
              {CONTENT_ORIGIN_BADGES[origin]}
            </span>
          ) : null}
        </div>
      </header>

      {post.coverPath ? (
        <div className="relative mt-6 aspect-[2.35/1] overflow-hidden rounded-lg bg-panel-2">
          {/* /wp-content/** 由 Nginx 直接服务,不走 next/image 优化器(arch/07-frontend §3;本地为 wp-content 路由兜底) */}
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

      {/* 创作方式显著提示条(合规显式标识):AI 系正文前明示,human 不渲染 */}
      {CONTENT_ORIGIN_BADGES[origin] ? (
        <div className="mt-6 flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 px-3.5 py-2.5">
          <svg className="ic mt-0.5 flex-none text-accent" aria-hidden="true">
            <use href="#i-robot" />
          </svg>
          <p className="text-xs leading-relaxed text-text-2">{CONTENT_ORIGIN_LABELS[origin]}</p>
        </div>
      ) : null}

      <div className="mt-8">
        {post.isPurchasable ? (
          /* 付费门禁(M21,提案 §5.4):ISR 缓存页只含服务端截断预览,
             全文仅 /api/pay/content 凭权益下发;解锁卡为客户端 island */
          <PayGateCard
            postId={post.id.toString()}
            price={post.purchasePrice?.toFixed(2) ?? ""}
            previewMd={post.contentMd ? previewMarkdown(post.contentMd) : null}
            previewHtml={post.contentMd ? null : post.contentHtml}
          />
        ) : (
          <ArticleBody contentMd={post.contentMd} contentHtml={post.contentHtml} />
        )}
      </div>

      <footer className="mt-12 border-t border-line/60 pt-4 text-sm text-text-3">
        <Link href="/articles/" className="hover:text-text-1">
          ← 返回全部文章
        </Link>
      </footer>
    </article>
  );
}
