/**
 * /projects/ 列表视图(M11 批③):终端风 `$ ls -la /projects` 头 + 仓库卡网格,
 * 空态降级注记(白名单未上架)。纯展示,RSC;取数在页面侧( ISR 600s)。
 */
import Link from "next/link";

import { formatStars } from "@/lib/github/public";
import { projectPath } from "@/lib/github/project-path";
import type { ShowcaseRepo } from "@/lib/github/public";

export default function ProjectsView({ repos }: { repos: ShowcaseRepo[] }): React.ReactElement {
  return (
    <section className="mx-auto w-full max-w-[var(--site-max-w)]">
      <div className="rounded-lg border border-line bg-panel font-mono text-[13px] shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-line bg-panel-2 px-4 py-2.5">
          <i className="h-2.5 w-2.5 rounded-full bg-red/70" />
          <i className="h-2.5 w-2.5 rounded-full bg-amber/70" />
          <i className="h-2.5 w-2.5 rounded-full bg-green/70" />
          <span className="ml-2 text-[11.5px] text-text-3">domonic18@17aitech — zsh</span>
        </div>
        <div className="px-4 py-3 text-text-2">
          <p>
            <span className="text-green">$</span> ls -la /projects
          </p>
          <p className="mt-1 text-[12px] text-text-3">
            total {repos.length} · 文章教用法,仓库给武器(配套教程见各项目详情)
          </p>
        </div>
      </div>

      {repos.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-line bg-panel px-4 py-10 text-center text-[13px] text-text-3">
          项目即将上架(白名单同步中),先去
          <Link href="/articles/" className="mx-1 text-accent hover:text-accent-hover">
            文章区
          </Link>
          逛逛
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {repos.map((repo) => (
            <Link
              key={repo.id}
              href={projectPath(repo.slug)}
              className="group flex flex-col rounded-lg border border-line bg-panel p-4 shadow-sm transition-colors hover:border-accent/40 hover:bg-panel-2"
            >
              <span className="flex items-center gap-2">
                <svg className="ic flex-none text-accent" aria-hidden="true">
                  <use href="#i-code" />
                </svg>
                <span className="truncate font-mono text-[13.5px] font-semibold text-text-1 group-hover:text-accent-hover">
                  {repo.fullName}
                </span>
                <span className="ml-auto inline-flex flex-none items-center gap-1 font-mono text-[11.5px] text-text-3">
                  <svg className="ic ic-sm" aria-hidden="true">
                    <use href="#i-star" />
                  </svg>
                  {formatStars(repo.stars)}
                </span>
              </span>
              {repo.description && (
                <span className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-text-3">
                  {repo.description}
                </span>
              )}
              <span className="mt-3 flex flex-wrap items-center gap-1.5">
                {repo.language && (
                  <span className="rounded border border-blue/25 bg-blue/10 px-1.5 py-px font-mono text-[10.5px] text-blue">
                    {repo.language}
                  </span>
                )}
                {repo.topics.slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="rounded border border-line bg-panel-2 px-1.5 py-px font-mono text-[10.5px] text-text-3"
                  >
                    {t}
                  </span>
                ))}
              </span>
              <span className="mt-3 flex items-center gap-4 border-t border-line/55 pt-2.5 font-mono text-[11.5px] text-text-3">
                <span className="inline-flex items-center gap-1">
                  <svg className="ic ic-sm" aria-hidden="true">
                    <use href="#i-book" />
                  </svg>
                  配套文章 ×{repo._count.posts}
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-accent opacity-0 transition-opacity group-hover:opacity-100">
                  详情 →
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
