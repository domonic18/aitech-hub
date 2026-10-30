/**
 * F23 种子词库(discovery?t=words):发现的种子源头台账——人工加词与任务
 * 产出统一管理。板定 7 列 词语|来源|状态|关联|最近命中|添加于|操作,搜索 +
 * 状态/来源筛选(服务端 GET 表单,零 client),勾选批量 生效/弃用(表体内),
 * 页脚统计。效能产出榜已上移分析总览(板 F11 种子词产出榜);发现触发在
 * 「发现任务」页与源管理·台账行内(板 note)。
 */
import Link from "next/link";

import { parseListSegment, parsePage } from "@/lib/admin/list";
import { listKeywordsAdmin } from "@/lib/discovery/admin";
import { keywordRelations } from "@/lib/discovery/word-relations";
import { keywordYieldAdmin } from "@/lib/discovery/word-yield";
import {
  DISCOVERY_PAGE_SIZE,
  KEYWORD_LIST_SEGMENTS,
  KEYWORD_STATUS_LABELS,
} from "@/lib/discovery/status";

import AdminPagination from "@/components/admin/AdminPagination";
import KeywordAddForm from "@/components/admin/discovery/KeywordAddForm";
import KeywordTable from "@/components/admin/discovery/KeywordTable";

/** 来源筛选白名单(板:手动|发现任务;库中 origin 就此两形) */
const ORIGINS = [
  ["", "全部"],
  ["manual", "手动"],
  ["hotword", "发现任务"],
] as const;

function wordsHref(segment: string, page: number, kw?: string, origin?: string): string {
  const sp = new URLSearchParams({ t: "words" });
  if (segment !== "all") sp.set("status", segment);
  if (kw) sp.set("kw", kw);
  if (origin) sp.set("origin", origin);
  if (page > 1) sp.set("page", String(page));
  return `/admin/insight/discovery/?${sp.toString()}`;
}

export default async function WordsBoard({
  searchParams,
}: {
  searchParams: { status?: string; page?: string; kw?: string; origin?: string };
}): Promise<React.ReactElement> {
  const segment = parseListSegment(KEYWORD_LIST_SEGMENTS, searchParams.status, "all");
  const page = parsePage(searchParams.page);
  const kw = searchParams.kw?.trim() || undefined;
  const origin = ORIGINS.some(([v]) => v !== "" && v === searchParams.origin)
    ? (searchParams.origin as string)
    : undefined;

  const [kwList, yields] = await Promise.all([
    listKeywordsAdmin({ segment, page, kw, origin }),
    keywordYieldAdmin(),
  ]);
  const totalPages = Math.max(1, Math.ceil(kwList.total / DISCOVERY_PAGE_SIZE));
  const yieldByWord = Object.fromEntries(yields.map((y) => [y.word, y]));
  const relations = await keywordRelations(kwList.items.map((k) => k.word));
  const segLabel = (s: string): string =>
    s === "all" ? "全部" : (KEYWORD_STATUS_LABELS[s as keyof typeof KEYWORD_STATUS_LABELS] ?? s);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">种子词库</h2>
          <p className="mt-0.5 text-xs text-text-3">
            发现的种子源头,人工加词与任务产出统一管理 · 效能产出见 分析总览 · 种子词产出榜 · 触发见
            发现任务
          </p>
        </div>
        <KeywordAddForm />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel px-4 py-2.5">
        {/* 窄屏一行放不下(输入框 176 + 两个下拉 + 筛选),换行不让「来源」
            卡片被挤出面板右缘(2026-10-30 移动端验收) */}
        <form
          method="GET"
          action="/admin/insight/discovery/"
          className="flex flex-wrap items-center gap-1.5"
        >
          <input type="hidden" name="t" value="words" />
          <input
            type="search"
            name="kw"
            defaultValue={kw ?? ""}
            placeholder="搜索词语…"
            aria-label="搜索词语"
            className="w-full min-w-0 rounded-sm border border-line bg-panel px-2 py-1 text-xs placeholder:text-text-3 focus:border-accent focus:outline-none sm:w-44"
          />
          <label className="text-[11px] text-text-3" htmlFor="kw-status">
            状态:
          </label>
          <select
            id="kw-status"
            name="status"
            defaultValue={segment}
            className="rounded-sm border border-line bg-panel px-1.5 py-1 text-xs text-text-2"
          >
            {KEYWORD_LIST_SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {segLabel(s)}
              </option>
            ))}
          </select>
          <label className="text-[11px] text-text-3" htmlFor="kw-origin">
            来源:
          </label>
          <select
            id="kw-origin"
            name="origin"
            defaultValue={origin ?? ""}
            className="rounded-sm border border-line bg-panel px-1.5 py-1 text-xs text-text-2"
          >
            {ORIGINS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="cursor-pointer rounded-sm border border-line bg-panel px-2.5 py-1 text-xs text-text-2 hover:border-line-hover hover:text-text-1"
          >
            筛选
          </button>
        </form>
        {(kw !== undefined || origin !== undefined || segment !== "all") && (
          <Link href={wordsHref("all", 1)} className="text-[11px] text-text-3 hover:text-accent">
            清除
          </Link>
        )}
        <span className="ml-auto text-[11px] text-text-3">
          勾选后可批量 生效 / 弃用 · 弃用词不再参与发现与统计
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <KeywordTable
          items={kwList.items}
          yieldByWord={yieldByWord}
          relByWord={Object.fromEntries(relations)}
        />
        <AdminPagination
          page={page}
          totalPages={totalPages}
          total={kwList.total}
          hrefFor={(p) => wordsHref(segment, p, kw, origin)}
          unit="词"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-3">
        <span>
          共 {kwList.counts.all} 词 · 生效 {kwList.counts.active} · 待定 {kwList.counts.pending} ·
          弃用 {kwList.counts.dismissed}
        </span>
        <span>生效词即参与发现轮(每日热词联想 + 每周 B站双窗搜索,LRU 轮转 20 词/轮)</span>
      </div>
    </div>
  );
}
