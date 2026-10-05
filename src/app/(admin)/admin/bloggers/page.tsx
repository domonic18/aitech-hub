/**
 * 博主台账页(M8 批③,侧栏「博主管理」;channels 页同款骨架):
 * 页顶 Cookie 池 + 网关健康双状态卡,博主台账表(账号/频率/健康/调度/操作)。
 * Cookie 只出脱敏 ttwid 前缀;网关不可达降级展示,不阻塞页面。
 */
import BloggerDialog from "@/components/admin/BloggerDialog";
import BloggerRowOps from "@/components/admin/BloggerRowOps";
import CookiePoolCard from "@/components/admin/CookiePoolCard";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { listBloggersAdmin } from "@/lib/telegram/bloggers-admin";
import { fetchGatewayHealth, getCookiePoolView } from "@/lib/telegram/social-platform-admin";
import { SOCIAL_CRAWL_INTERVAL_MIN, VIDEO_PLATFORM_DOUYIN } from "@/lib/telegram/constants";

export const dynamic = "force-dynamic";

function secUidShort(secUid: string): string {
  return secUid.length > 18 ? `${secUid.slice(0, 14)}…` : secUid;
}

/** 作品入口链接:抖音主页由 sec_uid 派生(库内不存主页 URL);其余平台未上线不出链接 */
function profileUrl(b: { platform: string; secUid: string }): string | null {
  return b.platform === VIDEO_PLATFORM_DOUYIN ? `https://www.douyin.com/user/${b.secUid}` : null;
}

export default async function AdminBloggersPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const [bloggers, pool, gateway] = await Promise.all([
    listBloggersAdmin(),
    getCookiePoolView(),
    fetchGatewayHealth(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">博主管理</h2>
          <p className="mt-0.5 text-xs text-text-3">
            视频博主台账:登记/轮询/健康度;Cookie 池为平台级共享,AES-256-GCM 加密落库只写不读。
          </p>
        </div>
        <BloggerDialog label="登记博主" />
      </div>

      {/* 状态卡 ×2(原型 kpi 双卡):Cookie 池(客户端,含导入)+ 网关健康(RSC) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <CookiePoolCard pools={pool.pools} />
        <div className="rounded-md border border-line bg-panel px-4 py-4">
          <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
            <svg className="ic text-accent" aria-hidden="true">
              <use href="#i-cloudserver" />
            </svg>
            抖音网关(douyin-gateway)
          </div>
          {gateway.reachable ? (
            <>
              <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-green">
                {gateway.status ?? "ok"}
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-text-3">
                签名 jar:可用 <b className="text-text-2">{gateway.jarsAvailable ?? 0}</b> / 共{" "}
                <b className="text-text-2">{gateway.jarsTotal ?? 0}</b>(网关内存风控冷却态)
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-red">
                unreachable
              </div>
              <div className="mt-1.5 text-[11px] text-text-3">
                网关不可达(检查容器/DOUYIN_GATEWAY_URL);采集失败不记博主连续失败
              </div>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">博主</th>
              <th className="px-3 py-2.5 font-medium">平台 / 分类</th>
              <th className="px-3 py-2.5 font-medium">频率</th>
              <th className="px-3 py-2.5 font-medium">健康</th>
              <th className="px-3 py-2.5 font-medium">调度</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {bloggers.map((b) => {
              const homeUrl = profileUrl(b);
              return (
                <tr
                  key={b.id}
                  className={`border-b border-line last:border-b-0 hover:bg-panel-2 ${
                    b.enabled ? "" : "opacity-60"
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-text-1">{b.nickname}</div>
                    {/* 作品入口(原型 ops「作品」;sec_uid 拼抖音主页,M8 批⑦) */}
                    {homeUrl ? (
                      <a
                        href={homeUrl}
                        target="_blank"
                        rel="noopener nofollow"
                        title={`${b.secUid} · 打开博主主页`}
                        aria-label={`打开 ${b.nickname} 的主页`}
                        className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-text-3 hover:text-accent-hover"
                      >
                        {secUidShort(b.secUid)}
                        <svg className="ic ic-sm" aria-hidden="true">
                          <use href="#i-export" />
                        </svg>
                        {b.remark && <span className="ml-1 font-sans">{b.remark}</span>}
                      </a>
                    ) : (
                      <div className="mt-0.5 font-mono text-[11px] text-text-3" title={b.secUid}>
                        {secUidShort(b.secUid)}
                        {b.remark && <span className="ml-2 font-sans">{b.remark}</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                      {b.platform}
                    </span>
                    {b.category && (
                      <div className="mt-0.5 text-[11px] text-text-3">{b.category}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-text-2">
                    {b.crawlIntervalMin}min
                  </td>
                  <td className="px-3 py-2.5">
                    {b.lastError ? (
                      <span
                        className="rounded-sm bg-red/10 px-1.5 py-px text-[10px] text-red"
                        title={b.lastError}
                      >
                        {b.consecutiveFails} 连败
                      </span>
                    ) : (
                      <span className="rounded-sm bg-green/10 px-1.5 py-px text-[10px] text-green">
                        ok
                      </span>
                    )}
                    {!b.platformEnabled && (
                      <div className="mt-0.5 font-mono text-[10px] text-amber">平台已停用</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] leading-relaxed text-text-3">
                    最新作品 {b.lastPostAt ? formatCnDateTime(b.lastPostAt) : "—"}
                    <br />
                    上轮 {b.lastRunAt ? formatCnDateTime(b.lastRunAt) : "—"}
                    <br />
                    下轮{" "}
                    {b.enabled && b.platformEnabled && b.nextRunAt
                      ? formatCnDateTime(b.nextRunAt)
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <BloggerRowOps
                      blogger={{
                        id: b.id,
                        nickname: b.nickname,
                        category: b.category,
                        crawlIntervalMin: b.crawlIntervalMin,
                        remark: b.remark,
                        enabled: b.enabled,
                      }}
                    />
                  </td>
                </tr>
              );
            })}
            {bloggers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-text-3">
                  还没有博主,点右上角「登记博主」接入第一批(建议先导入 Cookie 池)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:调度器每分钟扫描到期博主逐个入队(失败隔离在单博主 job);轮询间隔 ≥
        {SOCIAL_CRAWL_INTERVAL_MIN}min(平台礼貌红线);首采回填近 7 天至多 10
        条防刷屏;手动「回填」向前深扫 30 天(至多 3 页)补采,地板推进不回退;
        网关不可达顺延本轮不计失败, 上游风控(如 jar 全灭)计入连续失败。删除为两步武装:启用中
        409,停用后可物理删,已入库视频不受影响。 API:GET/POST /api/bloggers · PUT/DELETE
        /api/bloggers/[id] · PUT /api/bloggers/[id]/status · POST /api/bloggers/[id]/crawl · POST
        /api/bloggers/[id]/backfill · GET/POST/DELETE /api/bloggers/cookies。
      </p>
    </div>
  );
}
