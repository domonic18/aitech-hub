import type { Metadata } from "next";

import PostListView from "@/components/site/PostListView";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/constants";
import { searchPosts } from "@/lib/content/posts";

/** 搜索(04 文档 §1:动态 SSR,每请求查询;标题/摘要 LIKE,requirement §3.1) */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "搜索",
  robots: { index: false },
};

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

function parseQ(raw: string | undefined): string {
  return (raw ?? "").trim().slice(0, 100);
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1;
}

export default async function SearchPage({ searchParams }: PageProps): Promise<React.ReactElement> {
  const { q: rawQ, page: rawPage } = await searchParams;
  const q = parseQ(rawQ);
  const page = parsePage(rawPage);

  const result =
    q.length > 0
      ? await searchPosts(q, page, Math.min(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
      : { items: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE };

  return (
    <section>
      <header className="border-b border-neutral-200/60 pb-4">
        <h1 className="text-2xl font-bold">搜索</h1>
        <form action="/search" className="mt-3 flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="输入关键词,按标题/摘要匹配"
            className="w-full max-w-md rounded-md border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
          />
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
          >
            搜索
          </button>
        </form>
      </header>
      {q ? (
        <div className="mt-6">
          <PostListView
            heading={`“${q}” 的结果`}
            description={`共 ${result.total} 篇`}
            items={result.items}
            total={result.total}
            page={result.page}
            pageSize={result.pageSize}
            basePath="/search"
            pageHref={(p) =>
              p === 1
                ? `/search/?q=${encodeURIComponent(q)}`
                : `/search/?q=${encodeURIComponent(q)}&page=${p}`
            }
          />
        </div>
      ) : null}
    </section>
  );
}
