import type { Metadata } from "next";
import { notFound } from "next/navigation";

import TaxonomyListView, {
  resolveTaxonomy,
  taxonomyMetadata,
} from "@/components/site/TaxonomyList";

export const revalidate = 600;

interface PageProps {
  params: Promise<{ slug: string; page: string }>;
}

function parsePage(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 2 ? n : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, page: rawPage } = await params;
  const page = parsePage(rawPage);
  const info = await resolveTaxonomy("tag", slug);
  return info && page ? taxonomyMetadata("tag", info, page) : {};
}

export default async function TagPageN({ params }: PageProps): Promise<React.ReactElement> {
  const { slug, page: rawPage } = await params;
  const page = parsePage(rawPage);
  if (!page) notFound();
  const info = await resolveTaxonomy("tag", slug);
  if (!info) notFound();
  return <TaxonomyListView kind="tag" info={info} page={page} />;
}
