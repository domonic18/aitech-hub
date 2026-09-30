import type { Metadata } from "next";
import Link from "next/link";

import { listArchivePosts } from "@/lib/content/posts";
import { formatCnDate } from "@/lib/datetime";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "归档",
  description: "一起AI技术全部文章的时间线归档。",
  alternates: { canonical: "/archive/" },
};

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
    <section>
      <header className="border-b border-neutral-200/60 pb-4">
        <h1 className="text-2xl font-bold">归档</h1>
        <p className="mt-1 text-sm text-neutral-500">共 {posts.length} 篇</p>
      </header>
      {years.map((year) => (
        <section key={year} className="mt-8">
          <h2 className="text-lg font-semibold">{year}</h2>
          <ul className="mt-2 divide-y divide-neutral-200/60">
            {byYear.get(year)!.map((post) => {
              const date = formatCnDate(post.publishedAt);
              return (
                <li key={post.slug} className="flex items-baseline gap-3 py-2 text-sm">
                  <time
                    dateTime={post.publishedAt.toISOString()}
                    className="shrink-0 tabular-nums text-neutral-500"
                  >
                    {date.slice(5)}
                  </time>
                  <Link href={`/${post.slug}/`} className="hover:text-sky-700">
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
