/**
 * GitHub 仓库台账页(M11 批②,bloggers 页同款骨架):
 * 页顶同步健康 + API 令牌双状态卡,白名单台账表(仓库/热度/展示/健康/调度/操作)。
 * GITHUB_TOKEN 只出「已配置/未配置」布尔,值永不回显。
 */
import RepoDialog from "@/components/admin/github/RepoDialog";
import RepoRowOps from "@/components/admin/github/RepoRowOps";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { env } from "@/lib/env";
import { GITHUB_SYNC_INTERVAL_MIN } from "@/lib/github/constants";
import { listReposAdmin } from "@/lib/github/repos-admin";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  healthy: { text: "healthy", cls: "bg-green/10 text-green" },
  degraded: { text: "degraded", cls: "bg-amber/10 text-amber" },
  error: { text: "error", cls: "bg-red/10 text-red" },
};

export default async function AdminGithubPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const repos = await listReposAdmin();
  const counts = {
    total: repos.length,
    enabled: repos.filter((r) => r.enabled).length,
    displayed: repos.filter((r) => r.display).length,
    error: repos.filter((r) => r.status === "error").length,
    degraded: repos.filter((r) => r.status === "degraded").length,
  };
  const hasToken = env.GITHUB_TOKEN !== "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">GitHub 仓库</h2>
          <p className="mt-0.5 text-xs text-text-3">
            开源项目白名单台账:登记/同步/健康度/配套文章;slug 登记时派生此后冻结,前台 URL
            /projects/&#123;slug&#125;/。
          </p>
        </div>
        <RepoDialog label="登记仓库" />
      </div>

      {/* 状态卡 ×2:同步健康概览 + GitHub API 令牌 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-line bg-panel px-4 py-4">
          <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
            <svg className="ic text-accent" aria-hidden="true">
              <use href="#i-github" />
            </svg>
            白名单同步
          </div>
          <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-text-1">
            {counts.enabled}
            <span className="text-sm font-normal text-text-3"> / {counts.total} 调度中</span>
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-text-3">
            前台展示 <b className="text-text-2">{counts.displayed}</b> · 异常{" "}
            <b className={counts.error > 0 ? "text-red" : "text-text-2"}>{counts.error}</b> · 降级{" "}
            <b className={counts.degraded > 0 ? "text-amber" : "text-text-2"}>{counts.degraded}</b>
          </div>
        </div>
        <div className="rounded-md border border-line bg-panel px-4 py-4">
          <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
            <svg className="ic text-accent" aria-hidden="true">
              <use href="#i-key" />
            </svg>
            GitHub API 令牌
          </div>
          {hasToken ? (
            <>
              <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-green">
                configured
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-text-3">
                PAT 鉴权,限额 5000 req/h(仅 env 存储,不回显)
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-amber">
                unset
              </div>
              <div className="mt-1.5 text-[11px] text-text-3">
                未认证共享限额 60 req/h——白名单 ≤10 仓 × 每轮 4 请求贴线运行,建议配置 GITHUB_TOKEN
              </div>
            </>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">仓库</th>
              <th className="px-3 py-2.5 font-medium">热度</th>
              <th className="px-3 py-2.5 font-medium">展示</th>
              <th className="px-3 py-2.5 font-medium">健康</th>
              <th className="px-3 py-2.5 font-medium">调度</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {repos.map((r) => {
              const badge = STATUS_LABEL[r.status] ?? STATUS_LABEL.healthy;
              return (
                <tr
                  key={r.id}
                  className={`border-b border-line last:border-b-0 hover:bg-panel-2 ${
                    r.enabled ? "" : "opacity-60"
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <a
                        href={r.htmlUrl}
                        target="_blank"
                        rel="noopener nofollow"
                        className="font-mono font-medium text-text-1 hover:text-accent-hover"
                      >
                        {r.fullName}
                      </a>
                      {r.homepage && (
                        <a
                          href={r.homepage}
                          target="_blank"
                          rel="noopener nofollow"
                          title={`打开项目主页 ${r.homepage}`}
                          className="text-text-3 hover:text-accent-hover"
                        >
                          <svg className="ic ic-sm" aria-hidden="true">
                            <use href="#i-export" />
                          </svg>
                        </a>
                      )}
                    </div>
                    <div
                      className="mt-0.5 font-mono text-[11px] text-text-3"
                      title={`站内 /projects/${r.slug}/`}
                    >
                      /projects/{r.slug}/
                      {r.hasReadme && <span className="ml-1.5 text-green">README ✓</span>}
                    </div>
                    {r.description && (
                      <div
                        className="mt-0.5 max-w-md truncate text-[11px] text-text-3"
                        title={r.description}
                      >
                        {r.description}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-text-2">
                    ★ {r.stars}
                    <br />
                    {r.language ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-sm px-1.5 py-px text-[10px] ${
                        r.display ? "bg-accent-dim text-accent" : "bg-panel-2 text-text-3"
                      }`}
                    >
                      {r.display ? "上架" : "下架"}
                    </span>
                    <div className="mt-0.5 text-[11px] text-text-3">
                      排序 {r.sortOrder} · 文章 ×{r.postCount}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-sm px-1.5 py-px text-[10px] ${badge.cls}`}>
                      {badge.text}
                    </span>
                    {r.lastError && (
                      <div
                        className="mt-0.5 max-w-[160px] truncate font-mono text-[10px] text-red"
                        title={r.lastError}
                      >
                        {r.lastError}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] leading-relaxed text-text-3">
                    间隔 {r.syncIntervalMin}min
                    <br />
                    上轮 {r.lastSyncAt ? formatCnDateTime(r.lastSyncAt) : "—"}
                    <br />
                    下轮 {r.enabled && r.nextSyncAt ? formatCnDateTime(r.nextSyncAt) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <RepoRowOps
                      repo={{
                        id: r.id,
                        fullName: r.fullName,
                        enabled: r.enabled,
                        display: r.display,
                        syncIntervalMin: r.syncIntervalMin,
                        sortOrder: r.sortOrder,
                        remark: r.remark,
                      }}
                    />
                  </td>
                </tr>
              );
            })}
            {repos.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-text-3">
                  还没有仓库,点右上角「登记仓库」添加白名单(如 domonic18/aitech-hub)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:github-tick 每 5 分钟扫描到期仓库逐个入队(失败隔离在单仓 job);每轮拉 meta / README /
        commits×30 / releases×10,动态按 (repo,kind,external_id) 去重并裁剪至最新 50 条;meta 条件写与
        README sha 跳写保证无变化轮次不 bump updatedAt(不空转 sitemap)。
        网络故障/限频顺延不计连败,上游 4xx 计连败 ≥3 → error。slug 由仓库名派生此后冻结;
        删除为两步武装:调度启用中 409,停用后可物理删,动态与文章关联随级联清除。 默认同步间隔{" "}
        {GITHUB_SYNC_INTERVAL_MIN}min。 API:GET/POST /api/github/repos · PUT/DELETE
        /api/github/repos/[id] · PUT /api/github/repos/[id]/status · POST
        /api/github/repos/[id]/sync · GET/PUT /api/github/repos/[id]/posts。
      </p>
    </div>
  );
}
