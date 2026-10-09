/**
 * 我的订单页(M22 批③,需求4):状态分段 tab + 分页只读列表;pending 单
 * 「继续支付」回 /pay 收银台(收银台自会复用未过期单重出码)。RSC 守卫同
 * settings(verifyAccessToken 裸值单一契约)。列表公共工具复用 admin/list
 * 纯函数与 AdminPagination(hrefFor 注入,无 admin 耦合)。
 */
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import AdminPagination from "@/components/admin/AdminPagination";
import { ACCESS_COOKIE_NAME } from "@/lib/auth/constants";
import { verifyAccessToken } from "@/lib/auth/session";
import { formatCnDateTime } from "@/lib/datetime";
import { adminListHref, parseListSegment, parsePage } from "@/lib/admin/list";
import { listOrdersForUser, USER_ORDERS_PAGE_SIZE } from "@/lib/pay/user-orders";

export const dynamic = "force-dynamic";

export const metadata = { title: "我的订单" };

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
  return (
    <span className={`font-mono text-xs font-medium ${tone}`}>
      {STATUS_LABELS[status as OrderStatusFilter] ?? status}
    </span>
  );
}

export default async function AccountOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}): Promise<React.ReactElement> {
  const store = await cookies();
  // 单一契约:裸 token 值 + 框架解析 cookie(禁传完整 Cookie 头)
  const session = await verifyAccessToken(store.get(ACCESS_COOKIE_NAME)?.value ?? null);
  if (!session) redirect(`/login?next=${encodeURIComponent("/account/orders/")}`);

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const status = parseListSegment(ORDER_STATUSES, sp.status, "all");

  const { items, total } = await listOrdersForUser({
    userId: BigInt(session.sub),
    page,
    status: status === "all" ? null : status,
  });
  const totalPages = Math.max(1, Math.ceil(total / USER_ORDERS_PAGE_SIZE));
  const hrefFor = (p: number) =>
    adminListHref("/account/orders/", { status: status === "all" ? undefined : status, page: p });

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-lg font-bold">我的订单</h1>
      <p className="mt-1 text-xs text-text-3">单篇文章购买的支付记录;待支付单可继续完成支付。</p>

      <div className="mt-6 flex overflow-hidden rounded-sm border border-line">
        {ORDER_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/account/orders/${s === "all" ? "" : `?status=${s}`}`}
            className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
              s === status
                ? "bg-accent-dim font-semibold text-accent"
                : "bg-panel text-text-2 hover:bg-panel-2"
            }`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">订单号</th>
              <th className="px-4 py-2.5 font-medium">内容</th>
              <th className="px-4 py-2.5 font-medium">金额</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium">创建时间</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-text-3">
                  暂无订单
                </td>
              </tr>
            )}
            {items.map((o) => (
              <tr key={o.orderNo} className="border-b border-line/60 last:border-b-0">
                <td className="px-4 py-2.5 font-mono text-xs">{o.orderNo}</td>
                <td className="max-w-[220px] truncate px-4 py-2.5" title={o.title}>
                  {o.title || "—"}
                </td>
                <td className="px-4 py-2.5 font-mono">¥{o.amount}</td>
                <td className="px-4 py-2.5">{statusChip(o.status)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-text-2">
                  {formatCnDateTime(new Date(o.createdAt))}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  {o.status === "pending" ? (
                    <Link
                      href={`/pay/${o.orderNo}/`}
                      className="rounded-sm border border-accent bg-accent-dim px-2.5 py-1 text-xs font-medium text-accent hover:border-line-hover"
                    >
                      继续支付
                    </Link>
                  ) : (
                    <span className="text-xs text-text-3">—</span>
                  )}
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
    </div>
  );
}
