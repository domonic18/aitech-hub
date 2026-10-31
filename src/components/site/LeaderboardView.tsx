/**
 * /leaderboards/ 榜单视图(M63,RSC 零客户端 JS):三节编排——
 * 模型榜(智能指数散点 ∥ HF 趋势横条,双子页签)、论文(arXiv 卡片流)、
 * 热门仓库(GitHub 动量卡)。顶部锚点 chips 秒跳。
 * 不用 URL query 是为了保住 ISR 静态产物(App Router 里读 searchParams
 * 即转动态渲染);全量行同时直出进 HTML,SEO 与首屏一致。
 */
import { PageHeader } from "@/components/site/PageHeader";
import type { PublicLeaderboards } from "@/lib/leaderboard/public";

import { ModelBoard } from "./leaderboard/ModelBoard";
import { PaperBoard } from "./leaderboard/PaperBoard";
import { RepoBoard } from "./leaderboard/RepoBoard";

const NAV = [
  { href: "#models", label: "模型榜" },
  { href: "#papers", label: "论文" },
  { href: "#repos", label: "热门仓库" },
] as const;

export default function LeaderboardView({
  data,
}: {
  data: PublicLeaderboards;
}): React.ReactElement {
  const boards = data.boards;
  const models = boards.filter((b) => b.entityType === "model");
  const index = models.find((b) => b.key === "artificial-analysis") ?? null;
  const trending = models.find((b) => b.key === "huggingface") ?? null;
  const papers = boards.filter((b) => b.entityType === "paper");
  const repo = boards.find((b) => b.entityType === "repo") ?? null;
  const hasModels = index !== null || trending !== null;
  const empty = !hasModels && papers.length === 0 && repo === null;

  return (
    <PageHeader
      eyebrow="DATA · 榜单"
      title="AI 榜单"
      description="模型能力与价格的分布、社区当下在用的模型、最新论文与热门开源仓库——每日采集,名次变动与上一可用日期比较。数据来自各榜单官方页面,以原始来源为准。"
    >
      {empty ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-panel px-4 py-10 text-center text-[13px] text-text-3">
          榜单数据采集中(首次采集完成后自动上架)
        </p>
      ) : (
        <>
          <nav className="mt-5 flex flex-wrap gap-1.5">
            {NAV.filter(
              (n) =>
                (n.href === "#models" && hasModels) ||
                (n.href === "#papers" && papers.length > 0) ||
                (n.href === "#repos" && repo !== null),
            ).map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="rounded-sm bg-panel-2 px-3 py-1.5 text-[12.5px] text-text-2 hover:text-text-1"
              >
                {n.label}
              </a>
            ))}
          </nav>
          <p className="mt-3 font-mono text-[11px] text-text-3">最新数据日期 {data.asOf}</p>
          <div className="mt-6 space-y-12">
            <ModelBoard index={index} trending={trending} />
            <PaperBoard boards={papers} />
            {repo !== null && <RepoBoard board={repo} />}
          </div>
        </>
      )}
    </PageHeader>
  );
}
