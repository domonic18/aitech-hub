import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/site/PageHeader";
import { absoluteUrl } from "@/lib/seo/site";
import { SITE_TOPICS } from "@/lib/content/topics";

/**
 * /topics/ 专题索引(A1 专题聚合;2026-10-29 验收反馈三重设计:卡墙在单主题
 * 时孤单,改目录列表式——多主题自然成目录,单主题也是干净的一行入口)。
 * 工具钩子类参考页的聚合入口,后续专题(如硬件配置计算器)在此入列。价格
 * 速查为首个主题,/pricing/ 为其终态 URL(SEO 已收录,本页只做聚合可达性)。
 * ISR 600s 纯静态目录。
 */
export const revalidate = 600;

const PAGE_PATH = "/topics/";

export function generateMetadata(): Metadata {
  return {
    title: "专题",
    description: "一起AI 专题聚合:AI 模型价格速查等参考工具页入口,官方一手数据持续更新。",
    alternates: { canonical: PAGE_PATH },
  };
}

export default function TopicsPage(): React.ReactElement {
  return (
    <PageHeader
      eyebrow="TOPICS · 专题"
      title="专题"
      description="参考工具与数据速查类页面的聚合入口,随工具箱扩充持续上新。"
    >
      <div className="mt-6 overflow-hidden rounded-lg border border-line bg-panel">
        {SITE_TOPICS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group flex items-center gap-4 border-b border-line/60 px-5 py-4 transition-colors last:border-b-0 hover:bg-panel-2"
          >
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-accent/25 bg-accent/10 text-accent">
              <svg className="ic" aria-hidden="true">
                <use href="#i-tool" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold text-text-1 group-hover:text-accent-hover">
                  {t.label}
                </span>
                <span className="shrink-0 rounded border border-blue/25 bg-blue/10 px-1.5 py-px font-mono text-[10.5px] text-blue">
                  {t.tag}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-text-3">{t.desc}</span>
            </span>
            <span
              className="flex-none text-text-3 transition-all group-hover:translate-x-0.5 group-hover:text-accent"
              aria-hidden="true"
            >
              →
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-[11.5px] text-text-3">
        本页聚合地址:{absoluteUrl(PAGE_PATH)} · 各专题页 URL 独立且稳定 · 新专题随工具箱扩充在此上架
      </p>
    </PageHeader>
  );
}
