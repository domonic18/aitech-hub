import { getSiteTitle } from "@/lib/config/site-config";
import type { Metadata } from "next";

import ProjectsView from "@/components/site/ProjectsView";
import { listShowcaseRepos } from "@/lib/github/public";

/**
 * /projects/ 开源项目列表(M11 批③,arch/07-frontend §1:ISR 600s):
 * 白名单展示仓全部列出(sortOrder→stars),不分页(几十条量级,YAGNI)。
 * 静态路由优先级高于 (site)/[slug] legacy catcher,无冲突。
 */
export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const siteTitle = await getSiteTitle();
  return {
    title: "开源项目",
    description: `${siteTitle} 开源项目展示:domonic18 的 GitHub 仓库白名单,README 直读、进展动态与配套实战教程。`,
    alternates: { canonical: "/projects/" },
  };
}

export default async function ProjectsPage(): Promise<React.ReactElement> {
  const repos = await listShowcaseRepos();
  return <ProjectsView repos={repos} />;
}
