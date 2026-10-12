/**
 * 发现治理台(M25 批③):候选人工终审 + 热词词库管理,一屏一表(顶层 tab,
 * 共用 status/page 参数)。数据唯一真相源在本系统:批准博主候选即自动登记进
 * 「博主管理」(M26 批③追加拍板;幂等跳过已登记,失败附行内提示可回退重批);
 * 手动触发入 discovery 队列一次性 job,执行与风控节奏在 worker。L0 判定为
 * 元数据预筛,结论仅供参考,人工终审可覆盖。
 */
import Link from "next/link";

import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { parseListSegment, parsePage } from "@/lib/admin/list";
import { listCandidatesAdmin, listKeywordsAdmin } from "@/lib/discovery/admin";
import {
  CANDIDATE_LIST_SEGMENTS,
  CANDIDATE_STATUS_LABELS,
  CANDIDATE_TYPE_LABELS,
  DISCOVERY_PAGE_SIZE,
  DISCOVERY_TABS,
  KEYWORD_LIST_SEGMENTS,
  KEYWORD_STATUS_LABELS,
  type DiscoveryTab,
} from "@/lib/discovery/status";

import AdminPagination from "@/components/admin/AdminPagination";
import KeywordAddForm from "@/components/admin/discovery/KeywordAddForm";
import StatusControl from "@/components/admin/discovery/StatusControl";
import TriggerButtons from "@/components/admin/discovery/TriggerButtons";

export const dynamic = "force-dynamic";

const TAB_LABELS: Record<DiscoveryTab, string> = {
  candidates: "候选治理",
  keywords: "词库管理",
};

const CANDIDATE_TONES: Record<string, string> = {
  pending: "bg-amber/12 text-amber-hi",
  approved: "bg-green/12 text-green",
  rejected: "bg-red/12 text-red",
};

const KEYWORD_TONES: Record<string, string> = {
  pending: "bg-amber/12 text-amber-hi",
  active: "bg-green/12 text-green",
  dismissed: "bg-panel-2 text-text-2",
};

const L0_TONES: Record<string, string> = {
  pass: "bg-green/12 text-green",
  reject: "bg-red/12 text-red",
};

interface PageProps {
  searchParams: Promise<{ tab?: string; status?: string; page?: string }>;
}

function tabHref(tab: DiscoveryTab, segment: string, page: number): string {
  const sp = new URLSearchParams();
  if (tab !== "candidates") sp.set("tab", tab);
  if (segment !== "all") sp.set("status", segment);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return `/admin/discovery/${qs ? `?${qs}` : ""}`;
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

export default async function AdminDiscoveryPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const tab = parseListSegment(DISCOVERY_TABS, sp.tab, "candidates");
  const page = parsePage(sp.page);
  const kwTab = tab === "keywords";
  const kwSegment = parseListSegment(KEYWORD_LIST_SEGMENTS, sp.status, "all");
  const candSegment = parseListSegment(CANDIDATE_LIST_SEGMENTS, sp.status, "all");
  const segment: string = kwTab ? kwSegment : candSegment;

  const kw = kwTab ? await listKeywordsAdmin({ segment: kwSegment, page }) : null;
  const cand = kwTab ? null : await listCandidatesAdmin({ segment: candSegment, page });
  const total = kwTab ? kw!.total : cand!.total;
  const totalPages = Math.max(1, Math.ceil(total / DISCOVERY_PAGE_SIZE));
  const counts: Record<string, number> = kwTab ? kw!.counts : cand!.counts;
  const segLabel = (s: string): string =>
    s === "all"
      ? "全部"
      : kwTab
        ? (KEYWORD_STATUS_LABELS[s as keyof typeof KEYWORD_STATUS_LABELS] ?? s)
        : (CANDIDATE_STATUS_LABELS[s as keyof typeof CANDIDATE_STATUS_LABELS] ?? s);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">发现治理</h2>
          <p className="mt-0.5 text-xs text-text-3">
            热点词库与 B站候选(任务A/B 产物)的人工终审台;数据唯一真相源在本系统。
          </p>
        </div>
        <TriggerButtons />
      </div>

      {/* 顶层 tab:一屏一表,共用 status/page 参数 */}
      <div className="flex overflow-hidden rounded-sm border border-line">
        {DISCOVERY_TABS.map((t) => (
          <Link
            key={t}
            href={tabHref(t, "all", 1)}
            className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
              t === tab
                ? "bg-accent-dim font-semibold text-accent"
                : "bg-panel text-text-2 hover:bg-panel-2"
            }`}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </div>

      {kwTab ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-sm border border-line">
            {KEYWORD_LIST_SEGMENTS.map((seg) => (
              <Link
                key={seg}
                href={tabHref(tab, seg, 1)}
                className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
                  seg === kwSegment
                    ? "bg-accent-dim font-semibold text-accent"
                    : "bg-panel text-text-2 hover:bg-panel-2"
                }`}
              >
                {segLabel(seg)} {counts[seg]}
              </Link>
            ))}
          </div>
          <div className="ml-auto">
            <KeywordAddForm />
          </div>
        </div>
      ) : (
        <div className="flex overflow-hidden rounded-sm border border-line self-start">
          {CANDIDATE_LIST_SEGMENTS.map((seg) => (
            <Link
              key={seg}
              href={tabHref(tab, seg, 1)}
              className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
                seg === candSegment
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              {segLabel(seg)} {counts[seg]}
            </Link>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        {kwTab ? (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
                <th className="px-4 py-2.5 font-medium">词</th>
                <th className="px-3 py-2.5 font-medium">来源</th>
                <th className="px-3 py-2.5 font-medium">状态</th>
                <th className="px-3 py-2.5 font-medium">首见时间</th>
                <th className="px-3 py-2.5 font-medium">确认时间</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {kw!.items.map((k) => (
                <tr key={k.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                  <td className="px-4 py-2.5 font-medium text-text-1">{k.word}</td>
                  <td className="px-3 py-2.5 text-xs text-text-2">
                    {k.origin === "manual" ? (
                      "人工"
                    ) : (
                      <span title={k.source ?? undefined}>
                        联想{k.source ? ` · ${k.source}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusChip
                      tone={KEYWORD_TONES[k.status] ?? "bg-panel-2 text-text-2"}
                      label={
                        KEYWORD_STATUS_LABELS[k.status as keyof typeof KEYWORD_STATUS_LABELS] ??
                        k.status
                      }
                    />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                    {formatCnDateTime(k.firstSeenAt)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                    {k.confirmedAt ? formatCnDateTime(k.confirmedAt) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusControl
                      endpoint="keywords"
                      id={k.id}
                      status={k.status}
                      name={`词「${k.word}」`}
                    />
                  </td>
                </tr>
              ))}
              {kw!.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-xs text-text-3">
                    暂无关键词,可在上方人工添加或触发热词发现
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
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
              {cand!.items.map((c) => (
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
              {cand!.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-text-3">
                    暂无候选,可触发热词发现积累词库后运行 B站发现
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        <AdminPagination
          page={page}
          totalPages={totalPages}
          total={total}
          hrefFor={(p) => tabHref(tab, segment, p)}
          unit={kwTab ? "词" : "条"}
        />
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:L0 为元数据预筛(名称/标题黑名单与教学信号),reject 结论仅供参考,终审以人工为准;
        批准博主候选即自动登记进「博主管理」(幂等;失败会附行内提示,回退待定后重批可重试)。生效词参与每日热词联想与每周
        B站双窗搜索 (LRU 轮转,20 词/轮)。API:GET·POST /api/discovery/keywords · PUT
        /api/discovery/keywords/[id] · GET /api/discovery/candidates · PUT
        /api/discovery/candidates/[id] · POST /api/discovery/trigger。
      </p>
    </div>
  );
}
