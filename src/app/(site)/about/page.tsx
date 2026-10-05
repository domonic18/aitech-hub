import { getSiteTitle } from "@/lib/config/site-config";
import type { Metadata } from "next";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const siteTitle = await getSiteTitle();
  return {
    title: "关于",
    description: `${siteTitle}:domonic18 的个人品牌技术站。第一人称、可复现、可问责的 AI 工程实战记录,与 GitHub 开源联动。`,
    alternates: { canonical: "/about/" },
  };
}

/** 关于(requirement §3.1:重写;定位口径承袭 requirement §1 战略定稿) */
export default function AboutPage(): React.ReactElement {
  return (
    <section className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-bold">关于本站</h1>
      <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-text-2">
        <p>
          这里是 <strong>domonic18</strong> 的个人技术站「一起AI」。内容主线只有一条:
          <strong>一个人指挥智能体军团的公开实战档案</strong>——以第一人称记录 AI
          工程中的真实做法,可复现、含失败案例,每篇文章尽量附带可以直接跑起来的资产 (CLAUDE.md
          模板、skills、MCP 配置、工作流仓库)。
        </p>
        <p>
          与内容联动的开源项目都在 GitHub:
          <a
            href="https://github.com/domonic18"
            target="_blank"
            rel="noopener noreferrer"
            className="mx-1 text-accent underline underline-offset-4 hover:text-accent-hover"
          >
            github.com/domonic18
          </a>
          ——文章教用法,仓库给武器。
        </p>
        <p>
          本站同时为智能体而写:全站提供{" "}
          <a
            href="/llms.txt"
            className="text-accent underline underline-offset-4 hover:text-accent-hover"
          >
            llms.txt
          </a>{" "}
          结构化目录,每篇文章均可在地址后加{" "}
          <code className="rounded bg-panel-2 px-1 py-0.5 text-[13px]">.md</code> 获取 Markdown
          原文,欢迎 AI 助手与爬虫引用。
        </p>
        <p>
          站点由 WordPress 重写为 Next.js 全栈单体,旧文章、旧用户与全部旧 URL
          已完整迁移承接;浏览量为历史数据与新访问的累计值。
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <Link
              href="/articles/"
              className="text-accent underline underline-offset-4 hover:text-accent-hover"
            >
              全部文章
            </Link>
            :AI 工程实战原创内容
          </li>
          <li>
            <Link
              href="/archive/"
              className="text-accent underline underline-offset-4 hover:text-accent-hover"
            >
              归档
            </Link>
            :按时间线浏览
          </li>
          <li>
            <Link
              href="/agreement/"
              className="text-accent underline underline-offset-4 hover:text-accent-hover"
            >
              用户协议
            </Link>{" "}
            与{" "}
            <Link
              href="/privacy/"
              className="text-accent underline underline-offset-4 hover:text-accent-hover"
            >
              隐私政策
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}
