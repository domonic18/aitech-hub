import type { Metadata } from "next";
import { notFound } from "next/navigation";

import TaxonomyListView from "@/components/site/TaxonomyListView";
import { listCategories } from "@/lib/content/taxonomy";
import { resolveTaxonomy, taxonomyMetadata } from "@/lib/content/taxonomy-view";

export const revalidate = 600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** 分类页静态化:slug 为 DB 原始形态(ASCII;无库构建时降级按需 ISR——
 * listCategories 内部已走 prerenderSafe,运行时报错照常上抛,此处不再包 try/catch) */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const rows = await listCategories();
  return rows.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const info = await resolveTaxonomy("category", slug);
  return info ? await taxonomyMetadata("category", info, 1) : {};
}

export default async function CategoryPage({ params }: PageProps): Promise<React.ReactElement> {
  const { slug } = await params;
  const info = await resolveTaxonomy("category", slug);
  if (!info) notFound(); // resolveTaxonomy 未命中时已走 legacy 兜底,此处仅类型收窄
  return <TaxonomyListView kind="category" info={info} page={1} />;
}
