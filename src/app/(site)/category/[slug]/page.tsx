import type { Metadata } from "next";
import { notFound } from "next/navigation";

import TaxonomyListView, {
  resolveTaxonomy,
  taxonomyMetadata,
} from "@/components/site/TaxonomyList";
import { listCategories } from "@/lib/content/taxonomy";

export const revalidate = 600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** 分类页静态化:slug 为 DB 原始形态(ASCII;无库构建时降级按需 ISR) */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  try {
    const rows = await listCategories();
    return rows.map((c) => ({ slug: c.slug }));
  } catch {
    return [];
  }
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
