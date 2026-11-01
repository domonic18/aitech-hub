import { taxonomyPosts, type TaxonomyInfo, type TaxonomyKind } from "@/lib/content/taxonomy-view";

import PostListView from "./PostListView";

/** 分类/标签列表正文(异步 server component,数据自取);取数与 metadata 见
 * lib/content/taxonomy-view.ts(2026-11-01 从组件文件拆出)。 */
export default async function TaxonomyListView({
  kind,
  info,
  page,
}: {
  kind: TaxonomyKind;
  info: TaxonomyInfo;
  page: number;
}): Promise<React.ReactElement> {
  const { items, total, pageSize } = await taxonomyPosts(kind, info.slug, page);
  return (
    <PostListView
      heading={kind === "category" ? `分类:${info.name}` : `标签:${info.name}`}
      items={items}
      total={total}
      page={page}
      pageSize={pageSize}
      basePath={`/${kind}/${info.slug}`}
    />
  );
}
