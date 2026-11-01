import type { Metadata } from "next";
import { notFound } from "next/navigation";

import TaxonomyListView from "@/components/site/TaxonomyListView";
import { resolveTaxonomy, taxonomyMetadata } from "@/lib/content/taxonomy-view";
import { parsePageFromSecond } from "@/lib/pagination";

export const revalidate = 600;

interface PageProps {
  params: Promise<{ slug: string; page: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, page: rawPage } = await params;
  const page = parsePageFromSecond(rawPage);
  const info = await resolveTaxonomy("tag", slug);
  return info && page ? await taxonomyMetadata("tag", info, page) : {};
}

export default async function TagPageN({ params }: PageProps): Promise<React.ReactElement> {
  const { slug, page: rawPage } = await params;
  const page = parsePageFromSecond(rawPage);
  if (!page) notFound();
  const info = await resolveTaxonomy("tag", slug);
  if (!info) notFound();
  return <TaxonomyListView kind="tag" info={info} page={page} />;
}
