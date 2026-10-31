/**
 * /leaderboards/ 榜单视图(M63 v2,RSC 零客户端 JS):三节并列——模型能力与
 * 价格(散点)、Hugging Face 热门模型(散点)、热门仓库(动量卡)。论文榜前台
 * 移除(arXiv 采集保留,数据留库以后可恢复)。顶部锚点 chips 秒跳。
 * 不用 URL query 是为了保住 ISR 静态产物(App Router 里读 searchParams
 * 即转动态渲染);全量行同时直出进 HTML,SEO 与首屏一致。
 */
import { PageHeader } from "@/components/site/PageHeader";
import type { UsdCnyRate } from "@/lib/leaderboard/fx";
import type { PublicLeaderboard, PublicLeaderboards } from "@/lib/leaderboard/public";

import { HfBoard } from "./leaderboard/HfBoard";
import { ModelBoard } from "./leaderboard/ModelBoard";
import { RepoBoard } from "./leaderboard/RepoBoard";
import { SourceLink } from "./leaderboard/shared";

const NAV = [
  { href: "#models", label: "能力与价格" },
  { href: "#hf", label: "HF 热门模型" },
  { href: "#repos", label: "热门仓库" },
] as const;

export default function LeaderboardView({
  data,
  fx,
}: {
  data: PublicLeaderboards;
  /** 榜单价格双币切换用的展示汇率(默认人民币) */
  fx: UsdCnyRate;
}): React.ReactElement {
  const boards = data.boards;
  const index = boards.find((b) => b.key === "artificial-analysis") ?? null;
  const trending = boards.find((b) => b.key === "huggingface") ?? null;
  const repo = boards.find((b) => b.entityType === "repo") ?? null;
  const empty = index === null && trending === null && repo === null;
  const shown = [index, trending, repo].filter((b): b is PublicLeaderboard => b !== null);

  return (
    <PageHeader
      eyebrow="DATA · 榜单"
      title="AI 榜单"
      description="模型能力与价格的分布、社区当下在用的模型、热门开源仓库——每日采集,名次变动与上一可用日期比较。数据来自各榜单官方页面,以原始来源为准。"
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
                (n.href === "#models" && index !== null) ||
                (n.href === "#hf" && trending !== null) ||
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
            {index !== null && <ModelBoard board={index} fx={fx} />}
            {trending !== null && <HfBoard board={trending} />}
            {repo !== null && <RepoBoard board={repo} />}
          </div>
          {/* 页脚统一署名:三节各自的标题区已有来源 chip,这里再汇总一次口径与出处 */}
          <footer className="mt-10 border-t border-line pt-4">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11.5px] text-text-3">
              <span>本页数据来源</span>
              {shown.map((b) => (
                <SourceLink key={b.key} source={{ label: b.label, url: b.sourceUrl }} />
              ))}
            </p>
            <p className="mt-2 text-[11.5px] leading-relaxed text-text-3">
              每榜每日采集一次快照,名次变动与上一可用日期比较得出;排名与内容以各原始来源为准。
              模型输出价以上游美元报价为准,人民币为按当日汇率折算的展示值,仅供参考。
            </p>
          </footer>
        </>
      )}
    </PageHeader>
  );
}
