/**
 * 数据中心·源管理·博主候选池(F27 域,IA v5 自发现中心迁入):B站候选
 * 人工终审一屏一表,批准即自动登记进 博主台账(M26 批③拍板;幂等跳过
 * 已登记,失败附行内提示可回退重批)。数据唯一真相源在本系统:
 * 批准博主候选即自动登记进「博主」视图(M26 批③拍板;幂等跳过已登记,失败附
 * 行内提示可回退重批);手动触发入 discovery 队列一次性 job,执行与风控节奏在
 * worker。L0 判定为元数据预筛,结论仅供参考,人工终审可覆盖。
 */
import Link from "next/link";

import { parseListSegment, parsePage } from "@/lib/admin/list";
import { listCandidatesAdmin } from "@/lib/discovery/admin";
import {
  CANDIDATE_LIST_SEGMENTS,
  CANDIDATE_STATUS_LABELS,
  CANDIDATE_TYPE_LABELS,
  DISCOVERY_PAGE_SIZE,
} from "@/lib/discovery/status";

import AdminPagination from "@/components/admin/AdminPagination";
import StatusControl from "@/components/admin/discovery/StatusControl";
import TriggerButtons from "@/components/admin/discovery/TriggerButtons";

const CANDIDATE_TONES: Record<string, string> = {
  pending: "bg-amber/12 text-amber-hi",
  approved: "bg-green/12 text-green",
  rejected: "bg-red/12 text-red",
};

const L0_TONES: Record<string, string> = {
  pass: "bg-green/12 text-green",
  reject: "bg-red/12 text-red",
};

function candHref(segment: string, page: number, kw?: string): string {
  const sp = new URLSearchParams();
  if (segment !== "all") sp.set("status", segment);
  if (page > 1) sp.set("page", String(page));
  if (kw) sp.set("kw", kw);
  const qs = sp.toString();
  return `/admin/data/sources/?t=candidates${qs ? `&${qs}` : ""}`;
}

function fmtNum(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}

function StatusChip({ tone, label }: { tone: string; label: string }) {
  return (
    <span className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

export default async function MineCandidates({
  searchParams,
}: {
  searchParams: { status?: string; page?: string; kw?: string };
}): Promise<React.ReactElement> {
  const kw = searchParams.kw?.trim() || undefined;
  const segment = parseListSegment(CANDIDATE_LIST_SEGMENTS, searchParams.status, "all");
  const page = parsePage(searchParams.page);
  const cand = await listCandidatesAdmin({ segment, page, kw });
  const total = cand.total;
  const totalPages = Math.max(1, Math.ceil(total / DISCOVERY_PAGE_SIZE));
  const counts = cand.counts;
  const segLabel = (s: string): string =>
    s === "all"
      ? "全部"
      : (CANDIDATE_STATUS_LABELS[s as keyof typeof CANDIDATE_STATUS_LABELS] ?? s);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">博主候选池</h2>
          <p className="mt-0.5 text-xs text-text-3">
            B站候选(任务A/B 产物)的人工终审台;审核通过后自动登记至 博主台账,生效词在 洞察中心 · 发现
            · 种子词库 维护。
          </p>
        </div>
        <TriggerButtons />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-sm border border-line self-start">
          {CANDIDATE_LIST_SEGMENTS.map((seg) => (
            <Link
              key={seg}
              href={candHref(seg, 1, kw)}
              className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
                seg === segment
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              {segLabel(seg)} {counts[seg]}
            </Link>
          ))}
        </div>
        {kw && (
          <Link
            href="/admin/data/sources/?t=candidates"
            className="inline-flex items-center gap-1 rounded-sm bg-accent-dim px-2 py-1 text-xs text-accent hover:bg-accent/20"
            title="清除按词过滤"
          >
            词「{kw}」的产出 ✕
          </Link>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
              <th className="px-4 py-2.5 font-medium">类型</th>
              <th className="px-3 py-2.5 font-medium">主体</th>
              <th className="px-3 py-2.5 font-medium">命中信号</th>
              <th className="px-3 py-2.5 font-medium">L0 预筛</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 font-medium">轮次</th>
              <th className="px-4 py-2.5 text-right font-medium">终审</th>
            </tr>
          </thead>
          <tbody>
            {cand.items.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <td className="px-4 py-2.5">
                  <StatusChip
                    tone="bg-panel-2 text-text-2"
                    label={CANDIDATE_TYPE_LABELS[c.type] ?? c.type}
                  />
                </td>
                <td className="max-w-[300px] px-3 py-2.5">
                  {c.homepageUrl ? (
                    <a
                      href={c.homepageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-accent hover:underline"
                      title={c.title ?? c.author ?? c.homepageUrl}
                    >
                      {c.title ?? c.author ?? c.externalId}
                    </a>
                  ) : (
                    <span className="block truncate text-text-1">{c.title ?? c.author}</span>
                  )}
                  <div
                    className="mt-0.5 truncate font-mono text-[11px] text-text-3"
                    title={c.sampleTitles.length > 0 ? c.sampleTitles.join("\n") : undefined}
                  >
                    {c.type === "blogger"
                      ? `mid ${c.externalId}${c.sampleTitles.length > 0 ? ` · 样本×${c.sampleTitles.length}` : ""}`
                      : `UP:${c.author ?? "—"}`}
                  </div>
                </td>
                <td
                  className="px-3 py-2.5 text-xs text-text-2"
                  title={c.hitKeywords.length > 0 ? c.hitKeywords.join("、") : undefined}
                >
                  <div>
                    命中 {fmtNum(c.hitCount)} 词 · 播放峰值 {fmtNum(c.maxPlay)}
                  </div>
                  {c.type === "blogger" && (
                    <div className="mt-0.5 text-[11px] text-text-3">
                      粉丝 {fmtNum(c.fans)} · 投稿 {fmtNum(c.archives)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${L0_TONES[c.l0Verdict] ?? ""}`}
                    title={c.l0Reason ?? undefined}
                  >
                    {c.l0Verdict === "pass" ? "pass" : "reject"}
                  </span>
                  {c.l0Reason && (
                    <div
                      className="mt-0.5 max-w-[180px] truncate text-[11px] text-text-3"
                      title={c.l0Reason}
                    >
                      {c.l0Reason}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <StatusChip
                    tone={CANDIDATE_TONES[c.status] ?? "bg-panel-2 text-text-2"}
                    label={
                      CANDIDATE_STATUS_LABELS[c.status as keyof typeof CANDIDATE_STATUS_LABELS] ??
                      c.status
                    }
                  />
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">{c.round}</td>
                <td className="px-4 py-2.5">
                  <StatusControl
                    endpoint="candidates"
                    id={c.id}
                    status={c.status}
                    name={c.title ?? c.author ?? c.externalId}
                  />
                </td>
              </tr>
            ))}
            {cand.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-text-3">
                  暂无候选:到「洞察中心 · 发现 ·
                  种子词库」添加生效词后,点上方「热词发现」积累词库,再触发「B站发现」
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <AdminPagination
          page={page}
          totalPages={totalPages}
          total={total}
          hrefFor={(p) => candHref(segment, p, kw)}
          unit="条"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:L0 为元数据预筛(名称/标题黑名单与教学信号),reject 结论仅供参考,终审以人工为准;
        批准博主候选即自动登记进「博主」视图(幂等;失败会附行内提示,回退待定后重批可重试)。 生效词在
        洞察中心 · 发现 · 种子词库 维护,参与每日热词联想与每周 B站双窗搜索 (LRU 轮转,20 词/轮)。
        API:GET /api/discovery/candidates · PUT /api/discovery/candidates/[id] · POST
        /api/discovery/trigger。
      </p>
    </div>
  );
}
