import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import RepoReadme from "@/components/site/RepoReadme";
import RepoTimeline from "@/components/site/RepoTimeline";
import { postPath } from "@/lib/content/post-path";
import {
  formatStars,
  getProjectBySlug,
  listProjectsForSeo,
  listRepoActivity,
} from "@/lib/github/public";
import { isProjectSlug, PROJECTS_BASE, projectPath } from "@/lib/github/project-path";
import { absoluteUrl } from "@/lib/seo/site";

/**
 * 项目详情(M11 批④):slug 是唯一解析键(登记时派生此后冻结,**无 id 锚点,
 * 错 slug 直接 404 不做 308 归一**——与文章页的关键差异,见 CLAUDE.md slug 红线);
 * README 经独立 RepoReadme 渲染 + 进展动态时间轴 + 配套文章(admin 手动关联)。
 * display=false 视为下架,同 404;ISR 600s,admin 写侧即时 revalidate。
 */
export const revalidate = 600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return (await listProjectsForSeo()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!isProjectSlug(slug)) return {};
  const repo = await getProjectBySlug(slug);
  if (!repo) return {};
  const title = repo.fullName;
  const description = repo.description ?? `${repo.fullName} 的源码、README 与进展动态`;
  return {
    title,
    description,
    alternates: { canonical: projectPath(repo.slug) },
    openGraph: {
      type: "website",
      title,
      description,
      url: absoluteUrl(projectPath(repo.slug)),
      siteName: "一起AI",
    },
  };
}

export default async function ProjectPage({ params }: PageProps): Promise<React.ReactElement> {
  const { slug } = await params;
  // 非 [a-z0-9-] 形态(大写/点/下划线是 GitHub 名特征,派生后不可能出现)→ 404 不归一
  if (!isProjectSlug(slug)) notFound();
  const repo = await getProjectBySlug(slug);
  if (!repo) notFound();
  const activity = await listRepoActivity(repo.id, 20);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: repo.fullName,
    description: repo.description ?? undefined,
    url: absoluteUrl(projectPath(repo.slug)),
    codeRepository: repo.htmlUrl,
    author: { "@type": "Person", name: "domonic18", url: "https://github.com/domonic18" },
    programmingLanguage: repo.language ?? undefined,
  };

  return (
    <article className="mx-auto w-full max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header>
        <h1 className="font-mono text-2xl font-bold leading-snug sm:text-3xl">{repo.fullName}</h1>
        {repo.description && (
          <p className="mt-3 text-[14px] leading-relaxed text-text-2">{repo.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-text-3">
          <span className="inline-flex items-center gap-1">
            <svg className="ic ic-sm text-amber" aria-hidden="true">
              <use href="#i-star" />
            </svg>
            {formatStars(repo.stars)}
          </span>
          <span className="inline-flex items-center gap-1">
            <svg className="ic ic-sm" aria-hidden="true">
              <use href="#i-tool" />
            </svg>
            forks {repo.forks.toLocaleString("zh-CN")}
          </span>
          {repo.language && (
            <span className="rounded border border-blue/25 bg-blue/10 px-1.5 py-px font-mono text-[10.5px] text-blue">
              {repo.language}
            </span>
          )}
          {repo.topics.slice(0, 5).map((t) => (
            <span
              key={t}
              className="rounded border border-line bg-panel-2 px-1.5 py-px font-mono text-[10.5px] text-text-3"
            >
              {t}
            </span>
          ))}
          <a
            href={repo.htmlUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 hover:text-text-1"
          >
            GitHub
            <svg className="ic ic-sm" aria-hidden="true">
              <use href="#i-export" />
            </svg>
          </a>
          {repo.homepage && (
            <a
              href={repo.homepage}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1 hover:text-text-1"
            >
              主页
              <svg className="ic ic-sm" aria-hidden="true">
                <use href="#i-export" />
              </svg>
            </a>
          )}
        </div>
      </header>

      <div className="mt-8">
        <RepoReadme
          readmeMd={repo.readmeMd}
          fullName={repo.fullName}
          defaultBranch={repo.defaultBranch}
        />
      </div>

      {repo.posts.length > 0 && (
        <section className="mt-10">
          <h2 className="border-b border-line/60 pb-2 text-base font-semibold text-text-1">
            配套文章 ×{repo.posts.length}
          </h2>
          <ul className="mt-4 space-y-3">
            {repo.posts.map(({ post }) => (
              <li key={post.id.toString()}>
                <Link
                  href={postPath(post.id, post.slug)}
                  className="text-[13.5px] font-medium text-text-1 hover:text-accent-hover"
                >
                  {post.title}
                </Link>
                {post.excerpt && (
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-text-3">
                    {post.excerpt}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <RepoTimeline items={activity} />

      <footer className="mt-12 border-t border-line/60 pt-4 text-sm text-text-3">
        <Link href={`${PROJECTS_BASE}/`} className="hover:text-text-1">
          ← 全部项目
        </Link>
      </footer>
    </article>
  );
}
