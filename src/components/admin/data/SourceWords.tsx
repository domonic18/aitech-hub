/**
 * 数据中心·源管理词库视图(原发现中心「词库管理」页签→数据壳重组迁入):
 * discovery_keyword 台账,生效词(active)=发现搜索源,参与每日热词联想与每周
 * B站双窗搜索(LRU 轮转,20 词/轮);多选批量生效/弃用与行内启停语义同前。
 * 触发按钮就在页顶——加完词即可就地跑一轮发现。
 */
import Link from "next/link";

import { parseListSegment, parsePage } from "@/lib/admin/list";
import { listKeywordsAdmin } from "@/lib/discovery/admin";
import {
  DISCOVERY_PAGE_SIZE,
  KEYWORD_LIST_SEGMENTS,
  KEYWORD_STATUS_LABELS,
} from "@/lib/discovery/status";
import { keywordYieldAdmin } from "@/lib/discovery/word-yield";

import AdminPagination from "@/components/admin/AdminPagination";
import WordYieldCloud from "@/components/admin/data/WordYieldCloud";
import KeywordAddForm from "@/components/admin/discovery/KeywordAddForm";
import KeywordTable from "@/components/admin/discovery/KeywordTable";
import TriggerButtons from "@/components/admin/discovery/TriggerButtons";

const KEYWORD_TONES: Record<string, string> = {
  pending: "bg-amber/12 text-amber-hi",
  active: "bg-green/12 text-green",
  dismissed: "bg-panel-2 text-text-2",
};

function wordsHref(segment: string, page: number): string {
  const sp = new URLSearchParams();
  if (segment !== "all") sp.set("status", segment);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return `/admin/insight/discovery/?t=words${qs ? `&${qs}` : ""}`;
}

export default async function SourceWords({
  searchParams,
}: {
  searchParams: { status?: string; page?: string };
}): Promise<React.ReactElement> {
  const segment = parseListSegment(KEYWORD_LIST_SEGMENTS, searchParams.status, "all");
  const page = parsePage(searchParams.page);
  const [kw, yields] = await Promise.all([
    listKeywordsAdmin({ segment, page }),
    keywordYieldAdmin(),
  ]);
  const totalPages = Math.max(1, Math.ceil(kw.total / DISCOVERY_PAGE_SIZE));
  const yieldByWord = Object.fromEntries(yields.map((y) => [y.word, y]));
  const segLabel = (s: string): string =>
    s === "all" ? "全部" : (KEYWORD_STATUS_LABELS[s as keyof typeof KEYWORD_STATUS_LABELS] ?? s);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-sm border border-line self-start">
          {KEYWORD_LIST_SEGMENTS.map((seg) => (
            <Link
              key={seg}
              href={wordsHref(seg, 1)}
              className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
                seg === segment
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              {segLabel(seg)} {kw.counts[seg]}
            </Link>
          ))}
        </div>
        {/* 触发在页头(验收二批①:页脚不显眼,上移与加词同排)——加完词就地跑一轮 */}
        <div className="ml-auto flex items-center gap-3">
          <KeywordAddForm />
          <TriggerButtons />
        </div>
      </div>

      {/* 词库效能云(批② 词动线):产出重心一屏可见,点词跳候选治理按词过滤 */}
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">词库效能云</h3>
          <span className="text-[11px] text-text-3">
            字重=候选产出(批准×3)· 悬停看明细 · 点词看它挖到的候选
          </span>
        </div>
        <WordYieldCloud yields={yields} />
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <KeywordTable items={kw.items} tones={KEYWORD_TONES} yieldByWord={yieldByWord} />
        <AdminPagination
          page={page}
          totalPages={totalPages}
          total={kw.total}
          hrefFor={(p) => wordsHref(segment, p)}
          unit="词"
        />
      </div>

      <p className="max-w-3xl text-[11px] leading-relaxed text-text-3">
        说明:生效词(active)是发现管线的「燃料」——每日热词联想与每周 B站双窗搜索按词轮转搜索;
        弃用词不再参与。加完词点页头触发即可跑一轮,产出去「挖掘·候选治理」终审。 API:GET·POST
        /api/discovery/keywords · PUT /api/discovery/keywords/[id]。
      </p>
    </div>
  );
}
