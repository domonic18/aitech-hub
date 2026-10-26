/**
 * 数据中心·源管理·博主台账(F27 板,M8 批③起历经数据壳重组迁入):
 * 七列表 博主|平台|状态|挂靠任务|最近采集|已采集|操作——状态四态
 * (●采集中 amber = crawler 队列活跃 job / 启用 / 暂停 / 待验证 = 已登记未首采);
 * 启停收进行内(BloggerRowOps),页顶状态卡 ×4 与登记/回填/删除能力保留。
 */
import BloggerDialog from "@/components/admin/BloggerDialog";
import BloggerRowOps from "@/components/admin/BloggerRowOps";
import BloggerStatusCards from "@/components/admin/data/BloggerStatusCards";
import { formatCnTime, startOfCnDay } from "@/lib/datetime";
import { videoRunningAccounts } from "@/lib/collect/crawler-runs";
import { listBloggerVideoCounts, listBloggersAdmin } from "@/lib/telegram/bloggers-admin";
import {
  SOCIAL_CRAWL_INTERVAL_MIN,
  VIDEO_PLATFORM_BILIBILI,
  VIDEO_PLATFORM_DOUYIN,
  VIDEO_PLATFORM_LABELS,
} from "@/lib/telegram/constants";

function secUidShort(secUid: string): string {
  return secUid.length > 18 ? `${secUid.slice(0, 14)}…` : secUid;
}

/** 作品入口链接:抖音/B站主页由身份标识派生(库内不存主页 URL);其余平台未上线不出链接 */
function profileUrl(b: { platform: string; secUid: string }): string | null {
  if (b.platform === VIDEO_PLATFORM_DOUYIN) return `https://www.douyin.com/user/${b.secUid}`;
  if (b.platform === VIDEO_PLATFORM_BILIBILI) return `https://space.bilibili.com/${b.secUid}`;
  return null;
}

/** 最近采集相对时刻(板「6 分钟前 / 今天 09:30 / 昨天 21:30 / 10-19」) */
function lastRunAtText(at: Date): string {
  const minutes = Math.floor((Date.now() - at.getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟前`;
  const days = Math.round((startOfCnDay().getTime() - startOfCnDay(at).getTime()) / 86_400_000);
  if (days <= 0) return `今天 ${formatCnTime(at)}`;
  if (days === 1) return `昨天 ${formatCnTime(at)}`;
  return formatCnDateShort(at);
}

/** MM-DD(北京时区) */
function formatCnDateShort(at: Date): string {
  return at.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(5);
}

function cadenceOf(min: number): string {
  return min >= 60 ? `每 ${Math.round(min / 60)} 小时` : `每 ${min} 分钟`;
}

type BloggerRow = Awaited<ReturnType<typeof listBloggersAdmin>>[number];

/** 状态四态(F27):running > paused > 待验证(未首采)> 启用 */
function statusOf(b: BloggerRow, running: boolean): { label: string; cls: string; dot: string } {
  if (running)
    return {
      label: "采集中",
      cls: "text-amber",
      dot: "animate-pulse bg-amber",
    };
  if (!b.enabled) return { label: "暂停", cls: "text-text-3", dot: "bg-line" };
  if (b.lastRunAt === null) return { label: "待验证", cls: "text-blue", dot: "bg-blue" };
  return { label: "启用", cls: "text-green", dot: "bg-green" };
}

export default async function MineBloggers(): Promise<React.ReactElement> {
  const [bloggers, videoCounts, runningAccounts] = await Promise.all([
    listBloggersAdmin(),
    listBloggerVideoCounts(),
    videoRunningAccounts(),
  ]);
  const byPlatform = new Map<string, number>();
  for (const b of bloggers) byPlatform.set(b.platform, (byPlatform.get(b.platform) ?? 0) + 1);
  const platformSummary = [...byPlatform.entries()]
    .map(([p, n]) => `${VIDEO_PLATFORM_LABELS[p] ?? p} ${n}`)
    .join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">博主台账</h2>
          <p className="mt-0.5 text-xs text-text-3">
            手动触发与回填在行内;运行中博主 = 琥珀态,与渠道语义一致
          </p>
        </div>
        <BloggerDialog label="登记博主" />
      </div>

      <BloggerStatusCards />

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">博主</th>
              <th className="px-3 py-2.5 font-medium">平台</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 font-medium">挂靠任务</th>
              <th className="px-3 py-2.5 font-medium">最近采集</th>
              <th className="px-3 py-2.5 text-right font-medium">已采集</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {bloggers.map((b) => {
              const homeUrl = profileUrl(b);
              const running = runningAccounts.has(b.id);
              const st = statusOf(b, running);
              const videoCount = videoCounts.get(`${b.platform}\n${b.nickname}`) ?? 0;
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
                      {VIDEO_PLATFORM_LABELS[b.platform] ?? b.platform}
                    </span>
                    {b.category && (
                      <div className="mt-0.5 text-[11px] text-text-3">{b.category}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 text-xs ${st.cls}`}>
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${st.dot}`} />
                      {st.label}
                    </span>
                    {!b.platformEnabled && (
                      <div className="mt-0.5 font-mono text-[10px] text-amber">平台已停用</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-text-2">
                    {b.enabled && b.platformEnabled
                      ? `${VIDEO_PLATFORM_LABELS[b.platform] ?? b.platform}博主采集 · ${cadenceOf(b.crawlIntervalMin)}`
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-text-2">
                    {b.lastRunAt === null
                      ? "—"
                      : !b.enabled
                        ? `${formatCnDateShort(b.lastRunAt)} · 已暂停`
                        : `${lastRunAtText(b.lastRunAt)} · ${b.consecutiveFails > 0 ? "失败" : "正常"}`}
                    {b.consecutiveFails > 0 && b.enabled && b.lastError !== null && (
                      <div
                        className="mt-0.5 max-w-[180px] truncate text-[10px] text-red"
                        title={b.lastError}
                      >
                        {b.lastError}
                      </div>
                    )}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right font-mono text-[11px] text-text-2"
                    title={`近 7 天 ASR:转写 ${b.asr7d.done} 条${b.asr7d.degraded > 0 ? ` · 降级 ${b.asr7d.degraded} 条` : ""}`}
                  >
                    视频 {videoCount}
                    {(b.asr7d.done > 0 || b.asr7d.degraded > 0) && (
                      <div className="mt-0.5 text-[10px] text-text-3">
                        ASR 7d {b.asr7d.done}
                        {b.asr7d.degraded > 0 && (
                          <span className="text-amber"> ↓{b.asr7d.degraded}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
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
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-text-3">
                  还没有博主,点右上角「登记博主」接入第一批(建议先导入 Cookie 池)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="font-mono text-[11px] text-text-3">
        共 {bloggers.length} 位博主{platformSummary && ` · ${platformSummary}`} · 新增博主在
        博主候选池 审核通过后自动入此
      </p>

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:调度器每分钟扫描到期博主逐个入队(失败隔离在单博主 job);轮询间隔 ≥
        {SOCIAL_CRAWL_INTERVAL_MIN}min(平台礼貌红线);首采回填近 7 天至多 10
        条防刷屏;手动「回填」向前深扫 30 天(至多 3 页)补采,地板推进不回退;
        网关不可达顺延本轮不计失败, 上游风控(如 jar 全灭)计入连续失败。删除为两步武装:启用中
        409,停用后可物理删,已入库视频不受影响。 ASR 7d 为近 7 天转写条数/时长(按平台+昵称
        冗余名匹配),↓N 为缺转写降级数。 API:GET/POST /api/bloggers · PUT/DELETE /api/bloggers/[id] ·
        PUT /api/bloggers/[id]/status · POST /api/bloggers/[id]/crawl · POST
        /api/bloggers/[id]/backfill · GET/POST/DELETE /api/bloggers/cookies · GET/PUT
        /api/admin/proxy/config · POST /api/admin/proxy/test。
      </p>
    </div>
  );
}
