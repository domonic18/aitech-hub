import { getSiteSettings, getSiteTitle } from "@/lib/config/site-config";
import type { Metadata } from "next";

import ArticleBody from "@/components/article/ArticleBody";

export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const siteTitle = await getSiteTitle();
  return {
    title: "关于",
    description: `${siteTitle}:domonic18 的个人品牌技术站。第一人称、可复现、可问责的 AI 工程实战记录,与 GitHub 开源联动。`,
    alternates: { canonical: "/about/" },
  };
}

/**
 * 关于页(2026-10-05 反馈:内容后台可配):about.content markdown 走正文渲染链
 * ArticleBody(prose 排版),空/缺省回退内置默认文案(hero_md 同兜底模式);
 * 站点设置保存时 revalidatePath("/","layout") 已覆盖本页,即时再生。
 */
export default async function AboutPage(): Promise<React.ReactElement> {
  const { aboutMd } = await getSiteSettings();
  return (
    <section className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-bold">关于本站</h1>
      <div className="mt-6">
        <ArticleBody contentMd={aboutMd || DEFAULT_ABOUT_MD} contentHtml={null} />
      </div>
      {/* 微信公众号二维码(品牌资产随镜像分发 public/,不依赖媒体库与配置) */}
      <figure className="mt-8 flex flex-col items-center gap-2.5 rounded-md border border-line bg-panel p-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态资产,不走 next/image 优化域 */}
        <img
          src="/wechat-qrcode.jpg"
          alt="微信公众号「一起AI」二维码"
          width={168}
          height={168}
          loading="lazy"
          className="rounded-sm"
        />
        <figcaption className="text-xs text-text-3">微信扫码关注公众号「一起AI」</figcaption>
      </figure>
    </section>
  );
}

/** 内置默认文案(与原硬编码版内容一致;后台配置为空时回退) */
const DEFAULT_ABOUT_MD = `这里是 **domonic18** 的个人技术站「一起AI」。内容主线只有一条:**一个人指挥智能体军团的公开实战档案**——以第一人称记录 AI 工程中的真实做法,可复现、含失败案例,每篇文章尽量附带可以直接跑起来的资产(CLAUDE.md 模板、skills、MCP 配置、工作流仓库)。

与内容联动的开源项目都在 GitHub:[github.com/domonic18](https://github.com/domonic18)——文章教用法,仓库给武器。

本站同时为智能体而写:全站提供 [llms.txt](/llms.txt) 结构化目录,每篇文章均可在地址后加 \`.md\` 获取 Markdown 原文,欢迎 AI 助手与爬虫引用。

站点由 WordPress 重写为 Next.js 全栈单体,旧文章、旧用户与全部旧 URL 已完整迁移承接;浏览量为历史数据与新访问的累计值。

- [全部文章](/articles/):AI 工程实战原创内容
- [归档](/archive/):按时间线浏览
- [用户协议](/agreement/) 与 [隐私政策](/privacy/)`;
