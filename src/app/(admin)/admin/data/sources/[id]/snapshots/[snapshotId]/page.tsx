/**
 * 采集快照详情(M56 P0 回溯档案,2026-10-29):原页预览 / 源码 / 截图三视图
 * (?v=,默认预览)。预览走 /api/crawl-snapshots/<id>?f=view——服务端带
 * `CSP: sandbox`,此处再叠 iframe `sandbox=""`,双闸:第三方页面的脚本、
 * 表单、跳转一律不生效,只当静态文档看。
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdminPage } from "@/lib/auth/guard";
import { getSnapshotDetail } from "@/lib/collect/snapshot-admin";

export const dynamic = "force-dynamic";

const PARSE_LABEL: Record<string, string> = {
  pending: "未完成(worker 中断或运行中)",
  success: "解析成功",
  failed: "解析失败",
  empty: "解析成功但 0 行",
};

const VIEWS = [
  ["preview", "原页预览"],
  ["raw", "源码"],
  ["png", "截图"],
] as const;

function cnTime(at: Date): string {
  return at.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

export default async function AdminSnapshotDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; snapshotId: string }>;
  searchParams: Promise<{ v?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const { id, snapshotId } = await params;
  if (!/^\d{1,10}$/.test(id) || !/^\d{1,19}$/.test(snapshotId)) notFound();
  const sp = await searchParams;
  const v = VIEWS.some(([k]) => k === sp.v) ? (sp.v as (typeof VIEWS)[number][0]) : "preview";

  const detail = await getSnapshotDetail(Number(id), BigInt(snapshotId));
  if (detail === null) notFound();

  // 尾斜杠必带(trailingSlash 下 /api/.../<id> 会 308,iframe/img 内多一跳)
  const fileUrl = `/api/crawl-snapshots/${snapshotId}/`;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-text-3">
          <Link href="/admin/data/sources/" className="hover:text-accent">
            源管理
          </Link>
          <span>/</span>
          <Link href={`/admin/data/sources/${id}/snapshots/`} className="hover:text-accent">
            {detail.sourceLabel}
          </Link>
          <span>/</span>
          <span className="font-mono">#{detail.id}</span>
        </div>
        <h2 className="mt-1 text-base font-semibold">
          快照 #{detail.id} · {cnTime(detail.capturedAt)}
        </h2>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-line bg-panel px-4 py-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-text-3">快照态</dt>
          <dd className="mt-0.5 font-mono text-text-1">{detail.tab ?? "page"}</dd>
        </div>
        <div>
          <dt className="text-text-3">HTTP</dt>
          <dd className="mt-0.5 font-mono text-text-1">{detail.httpStatus ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-text-3">大小</dt>
          <dd className="mt-0.5 font-mono text-text-1">
            {Math.max(1, Math.round(detail.sizeBytes / 1024))} KB
          </dd>
        </div>
        <div>
          <dt className="text-text-3">解析结论</dt>
          <dd className="mt-0.5 text-text-1">
            {PARSE_LABEL[detail.parseStatus] ?? detail.parseStatus}
            {detail.rowCount !== null && ` · ${detail.rowCount} 行`}
          </dd>
        </div>
        <div className="col-span-2 sm:col-span-3">
          <dt className="text-text-3">源页</dt>
          <dd className="mt-0.5 break-all font-mono text-[11px] text-text-2">{detail.url}</dd>
        </div>
        <div>
          <dt className="text-text-3">SHA1</dt>
          <dd className="mt-0.5 break-all font-mono text-[11px] text-text-2">
            {detail.sha1.slice(0, 12)}
          </dd>
        </div>
        {detail.error !== null && (
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-text-3">错误</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-all text-[11px] text-red">
              {detail.error}
            </dd>
          </div>
        )}
      </dl>

      <div className="flex items-center gap-1">
        {VIEWS.map(([key, label]) => {
          const disabled = key === "png" && !detail.hasPng;
          return disabled ? (
            <span
              key={key}
              className="rounded-full px-3 py-1 text-xs text-text-3 opacity-50"
              title="该份快照未存截图"
            >
              {label}
            </span>
          ) : (
            <Link
              key={key}
              href={`/admin/data/sources/${id}/snapshots/${snapshotId}/?v=${key}`}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                v === key
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel-2 text-text-2 hover:bg-panel hover:text-text-1"
              }`}
            >
              {label}
            </Link>
          );
        })}
        <span className="ml-auto flex items-center gap-2">
          <a
            href={`${fileUrl}?f=${v === "png" ? "png" : v === "raw" ? "raw" : "view"}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm border border-line px-2 py-1 text-[11px] text-text-2 hover:border-accent hover:text-accent"
          >
            新窗打开
          </a>
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-panel">
        {v === "png" ? (
          // eslint-disable-next-line @next/next/no-img-element -- 私有动态字节流,不走 next/image 优化
          <img src={`${fileUrl}?f=png`} alt="快照整页截图" className="w-full" />
        ) : (
          <iframe
            src={`${fileUrl}?f=${v}`}
            sandbox=""
            title={v === "raw" ? "快照源码" : "快照原页预览"}
            className="h-[75vh] w-full bg-white"
          />
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        预览为当日取回的原页 DOM(相对资源可能缺失)· 脚本与表单被沙箱禁用 ·
        解析失配时以本页原文为准定位改版点,修 parser 时同步把该原文喂给 fixture 单测。
      </p>
    </div>
  );
}
