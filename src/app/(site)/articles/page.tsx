import type { Metadata } from "next";

import PostListView from "@/components/site/PostListView";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { listPostsPage } from "@/lib/content/posts";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "全部文章",
  description: "一起AI全部原创文章:AI 工程实战、Claude Code、MCP、LLM 训练与评测。",
  alternates: { canonical: "/articles/" },
};

export default async function ArticlesPage(): Promise<React.ReactElement> {
  const { items, total, page, pageSize } = await listPostsPage({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  return (
    <PostListView
      heading="全部文章"
      items={items}
      total={total}
      page={page}
      pageSize={pageSize}
      basePath="/articles"
    />
  );
}
