/**
 * 电报流时间轴页(M7 批⑤,原型 site-telegram;arch/07 §2 /telegram):
 * noindex(SEO 红线:聚合二手资讯不入索引,X-Robots-Tag 双保险);
 * RSC 首屏 + 客户端 60s 轮询增量;渠道筛选 URL 驱动。
 */
import type { Metadata } from "next";
import Link from "next/link";

import SiteSprite from "@/components/site/SiteSprite";
import TelegramTimeline from "@/components/site/TelegramTimeline";
import {
  countTodayVisible,
  listPublicChannels,
  listPublicTelegram,
} from "@/lib/telegram/public-feed";
import { PUBLIC_FEED_PAGE_SIZE } from "@/lib/telegram/public-feed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "电报流",
  description: "AI 资讯电报流:多渠道持续采集中,原文直达。",
  robots: { index: false, follow: true },
};

interface PageProps {
  searchParams: Promise<{ source?: string }>;
}

export default async function TelegramPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const sp = await searchParams;
  const sourceId = sp.source && /^\d{1,10}$/.test(sp.source) ? Number(sp.source) : undefined;

  const [items, today, channels] = await Promise.all([
    listPublicTelegram({ limit: PUBLIC_FEED_PAGE_SIZE, sourceId }),
    countTodayVisible(),
    listPublicChannels(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[var(--site-max-w)]">
      <SiteSprite />
      <div className="pg-head mt-6">
        <h1 className="flex flex-wrap items-center gap-3 text-xl font-bold">
          电报流
          <span className="inline-flex items-center gap-2 rounded-full border border-green/35 bg-green/10 px-3 py-0.5 font-mono text-[11px] font-normal text-green-hi">
            <span className="live-dot" aria-hidden="true" />
            LIVE · 持续采集中
          </span>
        </h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded-sm border border-line bg-panel px-2 py-0.5 font-mono text-[11px] text-text-3">
            今日 <b className="text-text-2">{today}</b> 条
          </span>
          <span className="rounded-sm border border-line bg-panel px-2 py-0.5 font-mono text-[11px] text-text-3">
            渠道 <b className="text-text-2">{channels.length}</b> 个
          </span>
        </div>
        <p className="mt-2 font-mono text-[11.5px] text-text-3">
          <span className="text-text-2">$</span> tail -f /telegram
          <span className="ml-2"># 多渠道巡检 · 文字资讯 · 60s 轮询刷新</span>
        </p>
      </div>

      <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-text-3">渠道</span>
            <Link
              href="/telegram/"
              aria-current={sourceId === undefined ? "true" : undefined}
              className={`rounded-sm border px-2.5 py-1 text-xs ${
                sourceId === undefined
                  ? "border-accent bg-accent-dim font-medium text-accent"
                  : "border-line bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              全部
            </Link>
            {channels.map((c) => (
              <Link
                key={c.id}
                href={`/telegram/?source=${c.id}`}
                aria-current={sourceId === c.id ? "true" : undefined}
                className={`rounded-sm border px-2.5 py-1 text-xs ${
                  sourceId === c.id
                    ? "border-accent bg-accent-dim font-medium text-accent"
                    : "border-line bg-panel text-text-2 hover:bg-panel-2"
                }`}
              >
                {c.name} <span className="font-mono text-text-3">{c.count}</span>
              </Link>
            ))}
          </div>
          <TelegramTimeline initialItems={items} sourceId={sourceId} />
        </main>

        <aside className="flex min-w-0 flex-col gap-4">
          <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
            <div className="border-b border-line bg-panel-2 px-4 py-2.5 text-[13.5px] font-bold">
              关于电报流
            </div>
            <div className="px-4 pb-3.5 pt-3 text-xs leading-relaxed text-text-2">
              <p>
                多渠道巡检采集的 AI 资讯流:规则清洗 + 屏蔽词过滤 + 同源去重后按时间滚动;
                摘要为一期规则截断,点击直达原文。
              </p>
              <p className="mt-2 text-text-3">
                本页不参与搜索引擎索引;站内文章见
                <Link href="/articles/" className="ml-1 text-accent hover:text-accent-hover">
                  文章列表
                </Link>
                。
              </p>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm opacity-70">
            <div className="border-b border-line bg-panel-2 px-4 py-2.5 text-[13.5px] font-bold">
              我的关注
            </div>
            <div className="px-4 pb-3.5 pt-3 text-xs text-text-3">
              按博主/渠道自定义订阅为三期规划,短信登录开放后可用。
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
