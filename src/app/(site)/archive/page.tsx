import { getSiteTitle } from "@/lib/config/site-config";
import type { Metadata } from "next";
import Link from "next/link";

import { listArchivePosts } from "@/lib/content/posts";
import { postPath } from "@/lib/content/post-path";
import { formatCnDate } from "@/lib/datetime";

export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const siteTitle = await getSiteTitle();
  return {
    title: "归档",
    description: `${siteTitle}全部文章的时间线归档。`,
    alternates: { canonical: "/archive/" },
  };
}

/** 归档(arch/07-frontend §1:ISR 600s;按年分组,154 篇量级单页承载) */
export default async function ArchivePage(): Promise<React.ReactElement> {
  const posts = await listArchivePosts();
  const byYear = new Map<number, typeof posts>();
  for (const post of posts) {
    const year = formatCnDate(post.publishedAt).slice(0, 4);
    const key = Number.parseInt(year, 10);
    const list = byYear.get(key) ?? [];
    list.push(post);
    byYear.set(key, list);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);

  return (
    <section className="mx-auto w-full max-w-3xl">
      <header className="border-b border-line/60 pb-4">
        <h1 className="text-2xl font-bold">归档</h1>
        <p className="mt-1 text-sm text-text-3">共 {posts.length} 篇</p>
      </header>
      {years.map((year) => (
        <section key={year} className="mt-8">
          <h2 className="text-lg font-semibold">{year}</h2>
          <ul className="mt-2 divide-y divide-line/60">
            {byYear.get(year)!.map((post) => {
              const date = formatCnDate(post.publishedAt);
              return (
                <li key={post.id} className="flex items-baseline gap-3 py-2 text-sm">
                  <time
                    dateTime={post.publishedAt.toISOString()}
                    className="shrink-0 tabular-nums text-text-3"
                  >
                    {date.slice(5)}
                  </time>
                  <Link href={postPath(post.id, post.slug)} className="hover:text-accent-hover">
                    {post.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
