/**
 * 采集计划页(M34 批③ 验收反馈·问题1,照搬 ai-invest 采集管理):登记表
 * 驱动的定时任务列表/日历双视图 + 常驻 tick 清单 + 热榜源台账(insight_hot_source,
 * 行内启停)+ 渠道间隔调度台账(crawl_source,管理动作在「渠道」页签)。
 */
import Link from "next/link";

import HotSourceLedger from "@/components/admin/spider/HotSourceLedger";
import ScheduleBoard from "@/components/admin/spider/ScheduleBoard";
import { requireAdminPage } from "@/lib/auth/guard";
import { buildScheduleEntries } from "@/lib/collect/schedules";
import { formatCnTime } from "@/lib/datetime";
import { listHotSourcesAdmin } from "@/lib/insight/hot-source";
import { listChannelsAdmin } from "@/lib/telegram/channels-admin";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = { rss: "RSS", "social-video": "视频" };

function hhmm(at: Date | null): string {
  return at === null ? "—" : formatCnTime(at);
}

/** 渠道间隔调度台账(采集计划视角:只读排程列;管理在渠道页签) */
async function ChannelIntervalLedger(): Promise<React.ReactElement> {
  const channels = await listChannelsAdmin();
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="border-b border-line px-4 py-3 text-sm font-semibold">
        渠道间隔调度
        <span className="ml-2 text-[11px] font-normal text-text-3">
          crawler tick 每分钟扫描,nextRunAt 到期即抓;单源失败隔离。增删改在
          <Link
            href="/admin/spider/channels/"
            className="mx-0.5 text-accent hover:text-accent-hover"
          >
            渠道
          </Link>
          页签
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
              <th className="px-4 py-2.5 font-medium">渠道</th>
              <th className="px-3 py-2.5 font-medium">类型</th>
              <th className="px-3 py-2.5 text-right font-medium">间隔</th>
              <th className="px-3 py-2.5 text-right font-medium">24h 入流</th>
              <th className="px-3 py-2.5 font-medium">最近运行</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <td className="px-4 py-2.5">
                  <span className={`text-text-1 ${c.enabled ? "" : "opacity-45"}`}>{c.name}</span>
                </td>
                <td className="px-3 py-2.5 text-text-3">
                  {TYPE_LABELS[c.type] ?? c.type}
                  {c.platform !== null && ` · ${c.platform}`}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[12px] text-text-2">
                  {c.crawlIntervalMin}min
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[12px] text-text-2">
                  {c.count24h}
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-text-3">
                  {hhmm(c.lastRunAt)}
                </td>
                <td className="px-4 py-2.5">
                  {c.consecutiveFails >= 3 ? (
                    <span className="rounded-sm bg-red/12 px-1.5 py-0.5 font-mono text-[10px] text-red">
                      连败 {c.consecutiveFails}
                    </span>
                  ) : c.enabled ? (
                    <span className="rounded-sm bg-green/12 px-1.5 py-0.5 font-mono text-[10px] text-green">
                      调度中
                    </span>
                  ) : (
                    <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-text-3">
                      停用
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {channels.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-text-3">
                  暂无文字渠道
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function AdminSpiderSchedulePage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const { calendar, resident } = buildScheduleEntries();
  const hotSources = await listHotSourcesAdmin();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">采集计划</h2>
        <p className="mt-0.5 text-xs text-text-3">
          系统全部周期任务的一份事实:定时批任务按北京时间列出,登记表与 cron 单一来源在
          src/lib/collect/schedules.ts;热榜源与渠道台账见下方。
        </p>
      </div>
      <ScheduleBoard calendar={calendar} resident={resident} />
      <HotSourceLedger rows={hotSources} />
      <ChannelIntervalLedger />
    </div>
  );
}
