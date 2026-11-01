import { notFound } from "next/navigation";

import ArticleFilterBar from "@/components/site/articles/ArticleFilterBar";
import ArticlesListView from "@/components/site/articles/ArticlesListView";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { listArticleFeed } from "@/lib/content/article-feed";
import { listCategoriesWithCount, listTagsWithCount } from "@/lib/content/taxonomy";
import { parsePageFromSecond } from "@/lib/pagination";

export const revalidate = 600;

interface PageProps {
  params: Promise<{ page: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const page = parsePageFromSecond((await params).page);
  return page
    ? { title: `全部文章 第 ${page} 页`, alternates: { canonical: `/articles/page/${page}/` } }
    : {};
}

export default async function ArticlesPageN({ params }: PageProps): Promise<React.ReactElement> {
  const page = parsePageFromSecond((await params).page);
  if (!page) notFound();
  const [{ items, total, postTotal, pinTotal, pageSize }, categories, tags] = await Promise.all([
    // 第 2 页起此前漏了 originalOnly,与第 1 页口径不一致(混入非原创且 total 偏移);
    // 合并流内已统一,2026-11-01 修复
    listArticleFeed({ page, pageSize: DEFAULT_PAGE_SIZE }),
    listCategoriesWithCount(),
    listTagsWithCount(),
  ]);
  if (items.length === 0) notFound();
  return (
    <ArticlesListView
      heading="全部文章"
      description={
        pinTotal > 0 ? `共 ${total} 条 · 文章 ${postTotal} · 贴图 ${pinTotal}` : `共 ${total} 篇`
      }
      items={items}
      total={total}
      page={page}
      pageSize={pageSize}
      basePath="/articles"
      filterBar={<ArticleFilterBar categories={categories} tags={tags} postTotal={postTotal} />}
    />
  );
}
