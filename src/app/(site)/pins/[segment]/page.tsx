/**
 * /pins/<id>-<slug>/ 贴图详情(M41,URL 终态同 post 纪律:id 是唯一解析锚,
 * slug 纯装饰派生自标题;非 canonical 段(bare-id/错 slug/任意尾巴)308 归一,
 * slug 可改可空外链永不毁)。published only;ISR 600s;构建期无库时
 * generateStaticParams 空 → 按需 ISR。
 */
import { getSiteTitle } from "@/lib/config/site-config";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import {
  asciiSlugFromTitle,
  parsePinSegment,
  pinPath,
  pinPathSegment,
} from "@/lib/content/pin-path";
import { formatCnDate } from "@/lib/datetime";
import { getPublishedPin, listPinSegmentsForPrerender } from "@/lib/pins/repo";
import { absoluteUrl } from "@/lib/seo/site";

export const revalidate = 600;

interface PageProps {
  params: Promise<{ segment: string }>;
}

export async function generateStaticParams(): Promise<Array<{ segment: string }>> {
  return (await listPinSegmentsForPrerender()).map((segment) => ({ segment }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { segment } = await params;
  const parsed = parsePinSegment(segment);
  const pin = parsed ? await getPublishedPin(parsed.id) : null;
  if (!pin) return {};
  const title = pin.title;
  const description = pin.content.slice(0, 120) || `${title} — 一起AI 贴图`;
  return {
    title,
    description,
    alternates: { canonical: pinPath(pin.id, asciiSlugFromTitle(pin.title)) },
    openGraph: {
      type: "article",
      title,
      description,
      url: absoluteUrl(pinPath(pin.id, asciiSlugFromTitle(pin.title))),
      siteName: await getSiteTitle(),
      publishedTime: pin.publishedAt?.toISOString(),
      images: pin.images[0] ? [{ url: absoluteUrl(pin.images[0].mediaPath) }] : undefined,
    },
  };
}

export default async function PinDetailPage({ params }: PageProps): Promise<React.ReactElement> {
  const { segment } = await params;
  const parsed = parsePinSegment(segment);
  const pin = parsed ? await getPublishedPin(parsed.id) : null;
  if (!pin) notFound();
  // 解析只认 id,URL 形态归一:非 canonical 段(含 bare-id、错 slug)永久重定向收敛信号
  const canonical = pinPathSegment(pin.id, asciiSlugFromTitle(pin.title));
  if (segment !== canonical) permanentRedirect(`/pins/${canonical}/`);

  return (
    <article className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 font-mono text-xs text-text-3">
        <Link href="/pins/" className="hover:text-accent">
          ← 贴图墙
        </Link>
        <span aria-hidden="true">/</span>
        {pin.publishedAt && <span>{formatCnDate(pin.publishedAt)}</span>}
        <span>{pin.images.length} 图</span>
      </div>
      <h1 className="text-2xl font-bold leading-snug text-text-1">{pin.title}</h1>
      {pin.content && (
        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-text-2">
          {pin.content}
        </p>
      )}
      {pin.readMoreUrl && (
        <a
          href={pin.readMoreUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[13px] text-accent hover:underline"
        >
          阅读原文
          <span aria-hidden="true">↗</span>
        </a>
      )}
      <div className="mt-6 flex flex-col gap-5">
        {pin.images.map((img, i) => (
          <figure key={img.id} className="overflow-hidden rounded-md border border-line bg-panel">
            <Image
              src={img.mediaPath}
              alt={`${pin.title}(${i + 1}/${pin.images.length})`}
              width={img.width ?? 864}
              height={img.height ?? 1152}
              unoptimized
              loading={i === 0 ? "eager" : "lazy"}
              className="h-auto w-full object-contain"
              sizes="(max-width: 720px) 100vw, 720px"
            />
          </figure>
        ))}
      </div>
    </article>
  );
}
