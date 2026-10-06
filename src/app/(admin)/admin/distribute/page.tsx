/**
 * 内容分发页(M17 批①,requirement §4 多渠道分发):公众号渠道配置 +
 * 同步记录。RSC 直读(records 免 API 路由),客户端岛负责交互。
 * 批⑤:记录表状态筛选(?status=,段式同 posts 页)+ 分页(AdminPagination
 * hrefFor 注入)。
 */
import Link from "next/link";

import AdminPagination from "@/components/admin/AdminPagination";
import DistributeAdminApp from "@/components/admin/distribute/DistributeAdminApp";
import { requireAdminPage } from "@/lib/auth/guard";
import { CHANNEL_WECHAT } from "@/lib/distribute/channels";
import { PUBLISH_RECORD_SEGMENTS, listPublishChannelRecords } from "@/lib/distribute/records";
import { getWechatConfigAdmin } from "@/lib/distribute/wechat-config-admin";
import { adminListHref, parseListSegment, parsePage } from "@/lib/admin/list";

export const dynamic = "force-dynamic";

const SEG_LABELS: Record<(typeof PUBLISH_RECORD_SEGMENTS)[number], string> = {
  all: "全部",
  synced: "已同步",
  pending: "同步中",
  failed: "失败",
};

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

export default async function AdminDistributePage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const segment = parseListSegment(PUBLISH_RECORD_SEGMENTS, sp.status, "all");
  const page = parsePage(sp.page);

  const [config, records] = await Promise.all([
    getWechatConfigAdmin(),
    listPublishChannelRecords({
      channel: CHANNEL_WECHAT,
      ...(segment !== "all" ? { status: segment } : {}),
      page,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(records.total / records.pageSize));
  const hrefFor = (p: number): string =>
    adminListHref("/admin/distribute", {
      status: segment === "all" ? undefined : segment,
      page: p,
    });

  const filter = (
    <div className="flex overflow-hidden rounded-sm border border-line">
      {PUBLISH_RECORD_SEGMENTS.map((seg) => (
        <Link
          key={seg}
          href={adminListHref("/admin/distribute", {
            status: seg === "all" ? undefined : seg,
          })}
          className={`border-r border-line px-3 py-1 text-xs last:border-r-0 ${
            seg === segment
              ? "bg-accent-dim font-semibold text-accent"
              : "bg-panel text-text-2 hover:bg-panel-2"
          }`}
        >
          {SEG_LABELS[seg]}
        </Link>
      ))}
    </div>
  );

  return (
    <DistributeAdminApp
      config={config}
      records={records.rows}
      total={records.total}
      filter={filter}
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
