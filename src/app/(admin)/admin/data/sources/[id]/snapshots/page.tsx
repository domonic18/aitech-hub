/**
 * F17 采集渠道·快照时间线(M56 P0 回溯档案,2026-10-29):单源最近 N 份
 * 取数原文 + 整页截图。入口在「数据中心·源管理·采集渠道」牌价行的「快照」。
 * 定位:页面改版导致解析失配时,先在这里看当时到底取到了什么(失败样本
 * 恰恰最有价值——快照在解析之前落盘)。
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdminPage } from "@/lib/auth/guard";
import { listSourceSnapshots } from "@/lib/collect/snapshot-admin";

export const dynamic = "force-dynamic";

const PARSE_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "未完成", cls: "text-amber" },
  success: { text: "解析成功", cls: "text-green" },
  failed: { text: "解析失败", cls: "text-red" },
  empty: { text: "空结果", cls: "text-amber" },
};

function cnTime(at: Date): string {
  return at.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function kb(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export default async function AdminSourceSnapshotsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) notFound();
  const view = await listSourceSnapshots(Number(id));
  if (view.source === null) notFound();
  const { source, rows, storage } = view;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-text-3">
          <Link href="/admin/data/sources/" className="hover:text-accent">
            源管理
          </Link>
          <span>/</span>
          <span>{source.label}</span>
          <span>/</span>
          <span>快照</span>
        </div>
        <h2 className="mt-1 text-base font-semibold">采集快照 · {source.label}</h2>
        <p className="mt-0.5 text-xs text-text-3">
          取数原文与整页截图(解析前落盘,失败样本同样保留)· 保留最近 20 份 · 源页{" "}
          <a href={source.url} target="_blank" rel="noreferrer" className="text-accent">
            {source.url}
          </a>
        </p>
      </div>

      <p className="rounded-md border border-line bg-panel px-3 py-2 text-[11px] text-text-2">
        存储:
        {storage === "cos" ? (
          <span className="ml-1 font-mono">COS 私有备份桶(crawl-snapshots/)</span>
        ) : (
          <span className="ml-1 font-mono text-amber">
            本地 workspace/snapshots(未配置 COS_BACKUP_BUCKET,仅本地开发兜底)
          </span>
        )}
      </p>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">采集时间</th>
              <th className="px-3 py-2.5 font-medium">快照态</th>
              <th className="px-3 py-2.5 font-medium">HTTP</th>
              <th className="px-3 py-2.5 font-medium">大小</th>
              <th className="px-3 py-2.5 font-medium">解析结论</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">查看</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = PARSE_LABEL[r.parseStatus] ?? {
                text: r.parseStatus,
                cls: "text-text-3",
              };
              return (
                <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-text-2">
                    {cnTime(r.capturedAt)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                      {r.tab ?? "page"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-text-2">
                    {r.httpStatus ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-text-2">
                    {kb(r.sizeBytes)}
                  </td>
                  <td className="max-w-[420px] px-3 py-2.5">
                    <span className={`text-xs ${st.cls}`}>
                      {st.text}
                      {r.rowCount !== null && ` · ${r.rowCount} 行`}
                    </span>
                    {r.error !== null && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-text-3">{r.error}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <Link
                      href={`/admin/data/sources/${source.id}/snapshots/${r.id}/`}
                      className="rounded-sm px-2 py-1 text-xs text-accent hover:bg-accent-dim"
                    >
                      打开
                    </Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-text-3">
                  该渠道暂无快照(下次采集成功后出现;或保留窗口内已被清理)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
