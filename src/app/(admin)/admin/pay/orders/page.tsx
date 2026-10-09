/**
 * 支付订单列表(M21 批⑤,提案 §8):pay_order 分页只读(单号/用户/金额/
 * 状态/网关单号/时间);人工开通/恢复入口(ManualGrantCard island,写侧走
 * entitlement 唯一写入口)。退款在虎皮椒商户后台手动操作,CD 回调自动撤权
 * (D3),本页不提供退款按钮。
 */
import AdminPagination from "@/components/admin/AdminPagination";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { listOrdersAdmin, PAY_ORDERS_PAGE_SIZE } from "@/lib/pay/admin";
import { adminListHref, parseListSegment, parsePage } from "@/lib/admin/list";

import AdminManualGrantCard from "@/components/pay/AdminManualGrantCard";

export const dynamic = "force-dynamic";

const ORDER_STATUSES = ["all", "pending", "paid", "closed", "refunded"] as const;
type OrderStatusFilter = (typeof ORDER_STATUSES)[number];
const STATUS_LABELS: Record<OrderStatusFilter, string> = {
  all: "全部",
  pending: "待支付",
  paid: "已支付",
  closed: "已关闭",
  refunded: "已退款",
};

function statusChip(status: string): React.ReactElement {
  const tone =
    status === "paid"
      ? "text-green"
      : status === "refunded"
        ? "text-amber"
        : status === "closed"
          ? "text-text-3"
          : "text-accent";
  return <span className={`font-mono text-xs font-medium ${tone}`}>{status}</span>;
}

export default async function AdminPayOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const status = parseListSegment(ORDER_STATUSES, sp.status, "all");

  const { items, total } = await listOrdersAdmin({
    page,
    status: status === "all" ? null : status,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAY_ORDERS_PAGE_SIZE));
  const hrefFor = (p: number) =>
    adminListHref("/admin/pay/orders/", { status: status === "all" ? undefined : status, page: p });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">支付订单</h2>
        <p className="mt-0.5 text-xs text-text-3">
          只读列表;退款在虎皮椒商户后台操作,CD 回调自动撤权;漏单由对账 job 5min 收敛。
        </p>
      </div>

      <div className="flex overflow-hidden rounded-sm border border-line">
        {ORDER_STATUSES.map((s) => (
          <a
            key={s}
            href={`/admin/pay/orders/?status=${s === "all" ? "" : s}`}
            className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
              s === status
                ? "bg-accent-dim font-semibold text-accent"
                : "bg-panel text-text-2 hover:bg-panel-2"
            }`}
          >
            {STATUS_LABELS[s]}
          </a>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">订单号</th>
              <th className="px-4 py-2.5 font-medium">用户</th>
              <th className="px-4 py-2.5 font-medium">内容</th>
              <th className="px-4 py-2.5 font-medium">金额</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium">网关</th>
              <th className="px-4 py-2.5 font-medium">流水号</th>
              <th className="px-4 py-2.5 font-medium">创建</th>
              <th className="px-4 py-2.5 font-medium">支付</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-xs text-text-3">
                  暂无订单
                </td>
              </tr>
            )}
            {items.map((o) => (
              <tr key={o.id} className="border-b border-line/60 last:border-b-0">
                <td className="px-4 py-2.5 font-mono text-xs">{o.orderNo}</td>
                <td className="px-4 py-2.5">{o.userLabel}</td>
                <td className="max-w-[220px] truncate px-4 py-2.5" title={o.title}>
                  {o.title || "—"}
                </td>
                <td className="px-4 py-2.5 font-mono">¥{o.amount}</td>
                <td className="px-4 py-2.5">{statusChip(o.status)}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-text-2">{o.gateway}</td>
                <td className="max-w-[140px] truncate px-4 py-2.5 font-mono text-xs text-text-3">
                  {o.gatewayTransactionId ?? "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-text-2">
                  {formatCnDateTime(new Date(o.createdAt))}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-text-2">
                  {o.paidAt ? formatCnDateTime(new Date(o.paidAt)) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AdminPagination
          page={page}
          totalPages={totalPages}
          total={total}
          hrefFor={hrefFor}
          unit="单"
        />
      </div>

      <AdminManualGrantCard />
    </div>
  );
}
