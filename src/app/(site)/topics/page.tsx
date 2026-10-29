import type { Metadata } from "next";
import Link from "next/link";

import { absoluteUrl } from "@/lib/seo/site";

/**
 * /topics/ 专题索引(A1 专题聚合,2026-10-29 验收拍板):工具钩子类参考页的
 * 聚合入口——主导航维度归位(内容频道 vs 参考专题),后续专题(如硬件配置
 * 计算器)在此入列,导航不再膨胀。价格速查为首个主题,/pricing/ 为其终态
 * URL(SEO 已收录,本页只做聚合可达性)。ISR 600s 纯静态卡墙。
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

/** 专题注册表(v1 静态常量:单主题 YAGNI;第二主题出现时再考虑 DB 化) */
const TOPICS: ReadonlyArray<{
  href: string;
  title: string;
  desc: string;
  tag: string;
}> = [
  {
    href: "/pricing/",
    title: "AI 模型价格速查",
    desc: "主流大模型官方牌价一觉:输入/输出价、免费额度与上下文窗口,Coding Plan 套餐额度口径。官方一手价人工核对,USD 原币直出,持续更新。",
    tag: "价格速查",
  },
];

export default function TopicsPage(): React.ReactElement {
  return (
    <section className="mx-auto w-full max-w-[var(--site-max-w)]">
      <p className="font-mono text-[11px] tracking-[0.2em] text-blue">TOPICS · 专题</p>
      <h1 className="mt-3 text-2xl font-bold sm:text-3xl">专题</h1>
      <p className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-text-2">
        参考工具与数据速查类页面的聚合入口,随工具箱扩充持续上新。
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOPICS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group flex flex-col rounded-lg border border-line bg-panel p-4 shadow-sm transition-colors hover:border-accent/40 hover:bg-panel-2"
          >
            <span className="flex items-center gap-2">
              <svg className="ic flex-none text-accent" aria-hidden="true">
                <use href="#i-tool" />
              </svg>
              <span className="truncate font-semibold text-[13.5px] text-text-1 group-hover:text-accent-hover">
                {t.title}
              </span>
              <span className="ml-auto shrink-0 rounded border border-blue/25 bg-blue/10 px-1.5 py-px font-mono text-[10.5px] text-blue">
                {t.tag}
              </span>
            </span>
            <span className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-text-3">
              {t.desc}
            </span>
            <span className="mt-3 flex items-center gap-1 border-t border-line/55 pt-2.5 text-[11.5px] text-text-3">
              <svg className="ic ic-sm" aria-hidden="true">
                <use href="#i-caret-right-fill" />
              </svg>
              进入专题
              <span className="ml-auto text-accent opacity-0 transition-opacity group-hover:opacity-100">
                →
              </span>
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-[11.5px] text-text-3">
        本页聚合地址:{absoluteUrl(PAGE_PATH)} · 各专题页 URL 独立且稳定
      </p>
    </section>
  );
}
