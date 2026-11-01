import { getSiteTitle } from "@/lib/config/site-config";
import type { Metadata } from "next";

import ArticleFilterBar from "@/components/site/articles/ArticleFilterBar";
import ArticlesListView from "@/components/site/articles/ArticlesListView";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { listArticleFeed } from "@/lib/content/article-feed";
import { listCategoriesWithCount, listTagsWithCount } from "@/lib/content/taxonomy";

export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const siteTitle = await getSiteTitle();
  return {
    title: "全部文章",
    description: `${siteTitle}全部原创文章:AI 工程实战、Claude Code、MCP、LLM 训练与评测。`,
    alternates: { canonical: "/articles/" },
  };
}

export default async function ArticlesPage(): Promise<React.ReactElement> {
  const [{ items, total, postTotal, pinTotal, page, pageSize }, categories, tags] =
    await Promise.all([
      // 文章 + 贴图合并时间流(2026-11-01 重构);文章仍按分类原创标记过滤,
      // 推荐视频等非原创分类不混入;贴图皆为站内原创,始终计入
      listArticleFeed({ page: 1, pageSize: DEFAULT_PAGE_SIZE }),
      listCategoriesWithCount(),
      listTagsWithCount(),
    ]);
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
