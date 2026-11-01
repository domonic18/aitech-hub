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
  const info = await resolveTaxonomy("category", slug);
  return info && page ? await taxonomyMetadata("category", info, page) : {};
}

export default async function CategoryPageN({ params }: PageProps): Promise<React.ReactElement> {
  const { slug, page: rawPage } = await params;
  const page = parsePageFromSecond(rawPage);
  if (!page) notFound();
  const info = await resolveTaxonomy("category", slug);
  if (!info) notFound();
  return <TaxonomyListView kind="category" info={info} page={page} />;
}
