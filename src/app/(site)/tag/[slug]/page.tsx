import type { Metadata } from "next";
import { notFound } from "next/navigation";

import TaxonomyListView, {
  resolveTaxonomy,
  taxonomyMetadata,
} from "@/components/site/TaxonomyList";
import { listTagSlugsForPrerender } from "@/lib/content/taxonomy";

export const revalidate = 600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** 标签 slug 为 DB 原始(可能 percent-encoded 中文)形态(arch/07-frontend §2 规则 5) */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return (await listTagSlugsForPrerender()).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const info = await resolveTaxonomy("tag", slug);
  return info ? await taxonomyMetadata("tag", info, 1) : {};
}

export default async function TagPage({ params }: PageProps): Promise<React.ReactElement> {
  const { slug } = await params;
  const info = await resolveTaxonomy("tag", slug);
  if (!info) notFound();
  return <TaxonomyListView kind="tag" info={info} page={1} />;
}
