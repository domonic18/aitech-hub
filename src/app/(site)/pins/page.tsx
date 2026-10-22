/**
 * /pins 贴图瀑布流(M41 渠道三前台):published only,ISR 600s,取数包
 * prerenderSafe(构建期无库降级空态,按需再生)。一屏 24 张(四列×6 行),
 * 量起后再议分页(YAGNI)。
 */
import { getSiteTitle } from "@/lib/config/site-config";
import type { Metadata } from "next";

import PinsWaterfall from "@/components/site/pins/PinsWaterfall";
import { PIN_SITE_PAGE_SIZE } from "@/lib/pins/constants";
import { listPublishedPins } from "@/lib/pins/repo";

export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const siteTitle = await getSiteTitle();
  return {
    title: "贴图",
    description: `${siteTitle}贴图墙:一图看懂 AI 热点的轻量图文(小绿书形态),与文章互为补充。`,
    alternates: { canonical: "/pins/" },
  };
}

export default async function PinsPage(): Promise<React.ReactElement> {
  const { items } = await listPublishedPins({ page: 1, pageSize: PIN_SITE_PAGE_SIZE });
  return (
    <div className="pt-8">
      <div className="mx-auto mb-5 w-full max-w-[var(--site-max-w)] px-4 sm:px-6">
        <h1 className="text-xl font-bold">贴图</h1>
        <p className="mt-1 font-mono text-xs text-text-3">
          $ tree /pins --format=waterfall · 一图看懂 AI 热点 · 轻量图文
        </p>
      </div>
      <PinsWaterfall items={items} emptyHint="还没有已发布的贴图——后台组装验收发布后这里可见" />
    </div>
  );
}
