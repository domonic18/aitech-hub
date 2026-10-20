import { getSiteTitle } from "@/lib/config/site-config";
import type { Metadata } from "next";

import PostListView from "@/components/site/PostListView";
import TagFilterBar from "@/components/site/TagFilterBar";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { listPostsPage } from "@/lib/content/posts";
import { listTagsWithCount } from "@/lib/content/taxonomy";

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
  const [{ items, total, page, pageSize }, tags] = await Promise.all([
    // 页面语义=全部「原创」文章(2026-10-20:按分类原创标记过滤,推荐视频等
    // 非原创分类不混入;分类页仍按各自 slug 全量展示)
    listPostsPage({ page: 1, pageSize: DEFAULT_PAGE_SIZE, originalOnly: true }),
    listTagsWithCount(),
  ]);
  return (
    <PostListView
      heading="全部文章"
      items={items}
      total={total}
      page={page}
      pageSize={pageSize}
      basePath="/articles"
      filterBar={<TagFilterBar tags={tags} />}
    />
  );
}
