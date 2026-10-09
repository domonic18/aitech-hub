/**
 * 我的消耗页(M22 批③,需求5):钱包余额卡(惰性月重置读侧)+ 本月
 * 消耗统计(次数/tokens/费用现算,admin 看板 costOfRow 同口径)+ 流水
 * 分页。读页即开户领赠额(额度库设计如此,读时惰性)。
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AdminPagination from "@/components/admin/AdminPagination";
import { ACCESS_COOKIE_NAME } from "@/lib/auth/constants";
import { verifyAccessToken } from "@/lib/auth/session";
import { formatCnDateTime } from "@/lib/datetime";
import { parsePage } from "@/lib/admin/list";
import { getTokenWallet } from "@/lib/users/token-balance";
import {
  getMonthUsage,
  listTokenLedger,
  TOKEN_LEDGER_LABELS,
  TOKEN_LEDGER_PAGE_SIZE,
  TOKEN_MONTHLY_GRANT,
} from "@/lib/users/account-usage";

export const dynamic = "force-dynamic";

export const metadata = { title: "我的消耗" };

function reasonChip(reason: string): React.ReactElement {
  const tone =
    reason === "consume" ? "text-amber" : reason === "reset" ? "text-text-3" : "text-green";
  return (
    <span className={`text-xs font-medium ${tone}`}>{TOKEN_LEDGER_LABELS[reason] ?? reason}</span>
  );
}

export default async function AccountUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.ReactElement> {
  const store = await cookies();
  // 单一契约:裸 token 值 + 框架解析 cookie(禁传完整 Cookie 头)
  const session = await verifyAccessToken(store.get(ACCESS_COOKIE_NAME)?.value ?? null);
  if (!session) redirect(`/login?next=${encodeURIComponent("/account/usage/")}`);
  const userId = BigInt(session.sub);

  const sp = await searchParams;
  const page = parsePage(sp.page);

  // 钱包先读(惰性开户/月重置是写事务),流水后读——并发读会撞在开户提交前,
  // 首读漏掉 grant 流水(冒烟实证)
  const wallet = await getTokenWallet(userId);
  const [usage, ledger] = await Promise.all([getMonthUsage(userId), listTokenLedger(userId, page)]);
  const totalPages = Math.max(1, Math.ceil(ledger.total / TOKEN_LEDGER_PAGE_SIZE));
  const hrefFor = (p: number) => (p > 1 ? `/account/usage/?page=${p}` : "/account/usage/");
  const usagePct = Math.min(
    100,
    Math.round(((TOKEN_MONTHLY_GRANT - wallet.balance) / TOKEN_MONTHLY_GRANT) * 100),
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-lg font-bold">我的消耗</h1>
      <p className="mt-1 text-xs text-text-3">
        AI 助手会话消耗 Token 额度;每月 1 日(北京时间)自动重置为{" "}
        {TOKEN_MONTHLY_GRANT.toLocaleString("en-US")}。
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-md border border-line bg-panel p-5 sm:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">当前余额</h2>
            <span className="text-xs text-text-3">{wallet.periodKey} 周期</span>
          </div>
          <p className="mt-2 font-mono text-2xl font-bold">
            {wallet.balance.toLocaleString("en-US")}
            <span className="ml-1 text-xs font-normal text-text-3">tokens</span>
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${usagePct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-text-3">
            本月额度 {TOKEN_MONTHLY_GRANT.toLocaleString("en-US")} · 已用 {usagePct}%
          </p>
        </div>
        <div className="rounded-md border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">本月消耗</h2>
          <p className="mt-2 font-mono text-2xl font-bold">
            {usage.tokens.toLocaleString("en-US")}
            <span className="ml-1 text-xs font-normal text-text-3">tokens</span>
          </p>
          <p className="mt-2 text-xs text-text-3">
            {usage.calls} 次 · 折合约 ¥{usage.cost.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">时间</th>
              <th className="px-4 py-2.5 font-medium">类型</th>
              <th className="px-4 py-2.5 text-right font-medium">变动</th>
              <th className="px-4 py-2.5 text-right font-medium">余额</th>
              <th className="px-4 py-2.5 font-medium">备注</th>
            </tr>
          </thead>
          <tbody>
            {ledger.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-text-3">
                  暂无流水
                </td>
              </tr>
            )}
            {ledger.items.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-b-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-text-2">
                  {formatCnDateTime(new Date(r.createdAt))}
                </td>
                <td className="px-4 py-2.5">{reasonChip(r.reason)}</td>
                <td
                  className={`px-4 py-2.5 text-right font-mono text-xs ${
                    r.delta >= 0 ? "text-green" : "text-amber"
                  }`}
                >
                  {r.delta >= 0 ? "+" : ""}
                  {r.delta.toLocaleString("en-US")}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">
                  {r.balanceAfter.toLocaleString("en-US")}
                </td>
                <td
                  className="max-w-[200px] truncate px-4 py-2.5 text-xs text-text-3"
                  title={r.note ?? ""}
                >
                  {r.note ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AdminPagination
          page={page}
          totalPages={totalPages}
          total={ledger.total}
          hrefFor={hrefFor}
          unit="条"
        />
      </div>
    </div>
  );
}
