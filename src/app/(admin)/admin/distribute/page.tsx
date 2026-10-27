/**
 * 分发中心页(M17 批①建;F16 板对齐):pageHead + KPI 三卡 + 渠道四卡 +
 * 最近同步记录。RSC 直读(records 免 API 路由),客户端岛负责交互;
 * 批⑤筛选(?status=,段式同 posts 页)/ 分页(AdminPagination hrefFor 注入)。
 */
import Link from "next/link";

import AdminPagination from "@/components/admin/AdminPagination";
import DistributeAdminApp from "@/components/admin/distribute/DistributeAdminApp";
import { requireAdminPage } from "@/lib/auth/guard";
import { DISTRIBUTE_CHANNELS, parseChannelParam } from "@/lib/distribute/channels";
import {
  PUBLISH_RECORD_SEGMENTS,
  getDistributeOverview,
  listDistributeRecords,
} from "@/lib/distribute/records";
import { getXhsLastProbe } from "@/lib/distribute/xhs-probe";
import { getWechatConfigAdmin } from "@/lib/distribute/wechat-config-admin";
import { adminListHref, parseListSegment, parsePage } from "@/lib/admin/list";

export const dynamic = "force-dynamic";

const SEG_LABELS: Record<(typeof PUBLISH_RECORD_SEGMENTS)[number], string> = {
  all: "全部",
  synced: "已同步",
  ready: "待发布",
  pending: "生成中",
  failed: "失败",
};

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string; channel?: string }>;
}

export default async function AdminDistributePage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const segment = parseListSegment(PUBLISH_RECORD_SEGMENTS, sp.status, "all");
  const page = parsePage(sp.page);
  // M48 批D:渠道维度接线(?channel=,经注册表校验)——缺省不过滤;
  // M50 批B:校验放行双载体全渠道,xiaohongshu 命中贴图行
  const channel = parseChannelParam(sp.channel);

  const [config, records, overview, lastProbe] = await Promise.all([
    getWechatConfigAdmin(),
    listDistributeRecords({
      ...(channel ? { channel } : {}),
      ...(segment !== "all" ? { status: segment } : {}),
      page,
    }),
    getDistributeOverview(channel),
    getXhsLastProbe(),
  ]);
  const totalPages = Math.max(1, Math.ceil(records.total / records.pageSize));
  const hrefFor = (p: number): string =>
    adminListHref("/admin/distribute", {
      status: segment === "all" ? undefined : segment,
      ...(channel ? { channel } : {}),
      page: p,
    });

  // M49 批X2:渠道 chips(?channel=,注册表单源)+ 状态 chips 双行
  const channelChips = (
    <div className="flex overflow-hidden rounded-sm border border-line">
      <Link
        href={adminListHref("/admin/distribute", {
          status: segment === "all" ? undefined : segment,
        })}
        className={`px-3 py-1 text-xs ${channel === undefined ? "bg-accent-dim font-semibold text-accent" : "bg-panel text-text-2 hover:bg-panel-2"}`}
      >
        全部渠道
      </Link>
      {Object.entries(DISTRIBUTE_CHANNELS).map(([ch, def]) => (
        <Link
          key={ch}
          href={adminListHref("/admin/distribute", {
            status: segment === "all" ? undefined : segment,
            channel: ch,
          })}
          className={`border-l border-line px-3 py-1 text-xs ${
            channel === ch
              ? "bg-accent-dim font-semibold text-accent"
              : "bg-panel text-text-2 hover:bg-panel-2"
          }`}
        >
          {def.label}
        </Link>
      ))}
    </div>
  );
  const filter = (
    <div className="flex flex-wrap items-center gap-2">
      {channelChips}
      <div className="flex overflow-hidden rounded-sm border border-line">
        {PUBLISH_RECORD_SEGMENTS.map((seg) => (
          <Link
            key={seg}
            href={adminListHref("/admin/distribute", {
              status: seg === "all" ? undefined : seg,
              ...(channel ? { channel } : {}),
            })}
            className={`border-r border-line px-3 py-1 text-xs last:border-r-0 ${
              seg === segment
                ? "bg-accent-dim font-semibold text-accent"
                : "bg-panel text-text-2 hover:bg-panel-2"
            }`}
          >
            {/* F16 板:失败 chip 带计数(「失败 2」),其余段不带 */}
            {seg === "failed" && overview.failedCount > 0
              ? `${SEG_LABELS[seg]} ${overview.failedCount}`
              : SEG_LABELS[seg]}
          </Link>
        ))}
      </div>
    </div>
  );

  return (
    <DistributeAdminApp
      config={config}
      overview={overview}
      records={records.rows}
      total={records.total}
      filter={filter}
      lastProbe={lastProbe}
    >
      <AdminPagination
        page={page}
        totalPages={totalPages}
        total={records.total}
        hrefFor={hrefFor}
        unit="条"
      />
    </DistributeAdminApp>
  );
}
