import { getSiteTitle } from "@/lib/config/site-config";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import ArticleBody from "@/components/article/ArticleBody";
import ArticleCopyright from "@/components/article/ArticleCopyright";
import ArticlePager from "@/components/article/ArticlePager";
import ArticleToc from "@/components/article/ArticleToc";
import ArticleTocInline from "@/components/article/ArticleTocInline";
import BackToTop from "@/components/article/BackToTop";
import PayGateCard from "@/components/pay/PayGateCard";
import PostComments from "@/components/site/comment/PostComments";
import PostLikeButton from "@/components/site/comment/PostLikeButton";
import PostRail from "@/components/site/PostRail";
import TelegramRail from "@/components/site/TelegramRail";
import { excerptOf } from "@/lib/content/format";
import {
  getAdjacentPosts,
  getPostById,
  listLatestPosts,
  listPostSegmentsForPrerender,
} from "@/lib/content/posts";
import { htmlToMarkdown } from "@/lib/content/html-to-md";
import { parsePostSegment, postPath, postPathSegment } from "@/lib/content/post-path";
import {
  CONTENT_ORIGIN_BADGES,
  CONTENT_ORIGIN_LABELS,
  asContentOrigin,
} from "@/lib/content/post-schema";
import { buildPostToc } from "@/lib/content/toc";
import { formatCnDate } from "@/lib/datetime";
import { countValidPurchases } from "@/lib/pay/entitlement";
import { previewMarkdown } from "@/lib/pay/preview";
import { prerenderSafe } from "@/lib/prerender-safe";
import { absoluteUrl } from "@/lib/seo/site";
import { AUTHOR_JSONLD } from "@/lib/site-meta";
import { listPublicTelegram } from "@/lib/telegram/public-feed";

/**
 * 文章详情(2026-10 URL 终态:/post/<id>-<slug>/ 混合形态,id 是唯一解析锚):
 * ISR + 按需 revalidate(M5 保存时直调);非 canonical 形态(/post/<id>/、错 slug、
 * 任意尾巴)308 归一到 canonical——slug 可改可空,外链永不毁。
 * generateStaticParams 返回 canonical 段(纯 ASCII,无编码问题)。
 *
 * 2026-11-01 阅读页优化:xl 三栏(左目录 180 + 正文 + 右栏 300)、lg 两栏、
 * 窄屏单栏(目录折叠成 details,右栏顺排文末);文末版权声明(后台可配)+
 * 上一篇/下一篇;右下角回到顶部。全部取数只读且不碰 cookies/headers,ISR 不受影响。
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

  // 门禁文只下发截断预览(M21):目录与 PayGateCard 共用同一份预览——目录只列
  // 用户真正可见的标题,不泄露全文结构。解锁后全文由客户端渲染,目录不追加(已知取舍)。
  const gated = post.isPurchasable || post.isLoginRequired;
  const previewMd = gated
    ? previewMarkdown(
        // 旧 HTML 文先转 md 再截断:全文(含 HTML 形态)永不进 RSC payload
        post.contentMd ?? (post.contentHtml ? htmlToMarkdown(post.contentHtml) : ""),
      )
    : undefined;

  const [adjacent, recentPosts, recentTelegram] = await Promise.all([
    getAdjacentPosts({ id: post.id, publishedAt: post.publishedAt }),
    listLatestPosts(6),
    listPublicTelegram({ limit: 5 }),
  ]);
  // 目录是增强项:解析失败/无标题时返回空数组,页面退化为无目录版式
  const body = buildPostToc({
    contentMd: post.contentMd,
    contentHtml: post.contentHtml,
    previewMd,
  });
  // 右栏「最近文章」:剔除当前文后补足 5 条(与首页 rail 同款卡,不重复正文入口)
  const railPosts = recentPosts.filter((p) => p.id !== post.id).slice(0, 5);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: AUTHOR_JSONLD,
    publisher: { "@type": "Person", name: AUTHOR_JSONLD.name },
    mainEntityOfPage: absoluteUrl(postPath(post.id, post.slug)),
    image: post.coverPath ? absoluteUrl(post.coverPath) : undefined,
    // 门禁文章如实声明(M21):对爬虫与用户下发同一份截断预览,无 cloaking
    ...(post.isPurchasable || post.isLoginRequired
      ? {
          isAccessibleForFree: false,
          hasPart: { "@type": "WebPageElement", isAccessibleForFree: false, cssSelector: ".prose" },
        }
      : {}),
  };

  return (
    <>
      <div className="mx-auto w-full max-w-[var(--site-max-w)]">
        <div
          className={`grid items-start gap-8 ${
            body.toc.length > 0
              ? "lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[180px_minmax(0,1fr)_300px]"
              : "lg:grid-cols-[minmax(0,1fr)_300px]"
          }`}
        >
          {/* 桌面吸顶目录(xl 起显示);lg 以下由正文顶部的折叠块接管 */}
          <ArticleToc items={body.toc} />

          <article className="min-w-0">
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />
            <header>
              <h1 className="text-2xl font-bold leading-snug sm:text-3xl">{post.title}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
                {post.publishedAt ? (
                  <time dateTime={post.publishedAt.toISOString()}>
                    {formatCnDate(post.publishedAt)}
                  </time>
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

            {/* 移动/平板目录折叠块(不打断「标题 → 封面」的视觉顺序,故置于封面之前) */}
            <ArticleTocInline items={body.toc} className="mt-4" />

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
                <p className="text-xs leading-relaxed text-text-2">
                  {CONTENT_ORIGIN_LABELS[origin]}
                </p>
              </div>
            ) : null}

            <div className="mt-8">
              {gated ? (
                /* 门禁(M21,提案 §5.4 + 补齐批):ISR 缓存页只含服务端截断预览,
                   全文仅 /api/pay/content 凭权益(付费)或登录态(登录可见)下发;
                   解锁卡为客户端 island */
                <PayGateCard
                  gate={post.isPurchasable ? "paid" : "login"}
                  postId={post.id.toString()}
                  price={post.purchasePrice?.toFixed(2) ?? ""}
                  salesCount={
                    post.isPurchasable
                      ? await prerenderSafe("pay.sales", 0, () => countValidPurchases(post.id))
                      : 0
                  }
                  nextPath={postPath(post.id, post.slug)}
                  previewMd={previewMd ?? ""}
                />
              ) : (
                /* 旧文 content_html 由 toc.ts 注入 heading id 后再下发(库内原值不动) */
                <ArticleBody
                  contentMd={post.contentMd}
                  contentHtml={body.contentHtml ?? post.contentHtml}
                />
              )}
            </div>

            {/* 文末版权声明(后台「站点设置 · 文章页」可配,空则不渲染) */}
            <div className="mt-8">
              <ArticleCopyright />
            </div>

            {/* 上一篇 / 下一篇(与列表同排序键:上一篇 = 更早,下一篇 = 更新) */}
            <div className="mt-6">
              <ArticlePager prev={adjacent.prev} next={adjacent.next} />
            </div>

            {/* 互动区(M23):点赞 + 评论区,均为 client island 不进 ISR(arch/07 §2) */}
            <div className="mt-8 border-t border-line/60 pt-4">
              <PostLikeButton postId={post.id.toString()} />
            </div>
            <PostComments postId={post.id.toString()} />

            <footer className="mt-12 border-t border-line/60 pt-4 text-sm text-text-3">
              <Link href="/articles/" className="hover:text-text-1">
                ← 返回全部文章
              </Link>
            </footer>
          </article>

          {/* 右栏:lg 起挂右侧,xl 起为第三列;窄屏顺排到正文之后(单栏阅读不被截断) */}
          <aside className="flex min-w-0 flex-col gap-4">
            {railPosts.length > 0 ? (
              <PostRail
                icon="#i-read"
                title="最近文章"
                tag="BLOG"
                posts={railPosts}
                footerLink={{ href: "/articles/", label: "全部文章 →" }}
              />
            ) : null}
            <TelegramRail items={recentTelegram} />
          </aside>
        </div>
      </div>
      <BackToTop />
    </>
  );
}
