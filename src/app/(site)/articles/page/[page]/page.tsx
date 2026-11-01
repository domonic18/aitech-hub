import { notFound } from "next/navigation";

import PostListView from "@/components/site/PostListView";
import TagFilterBar from "@/components/site/TagFilterBar";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { listPostsPage } from "@/lib/content/posts";
import { listTagsWithCount } from "@/lib/content/taxonomy";
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
  const [{ items, total, pageSize }, tags] = await Promise.all([
    listPostsPage({ page, pageSize: DEFAULT_PAGE_SIZE }),
    listTagsWithCount(),
  ]);
  if (items.length === 0) notFound();
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
