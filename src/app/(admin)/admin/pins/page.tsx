/**
 * 贴图工作台列表(M41 渠道三主控台):流水线示意条 + 状态分段(带计数)+
 * 3:4 竖图网格(小绿书形态)+ 详情抽屉 + 新建/AI 生成入口。数据服务端直取
 * repo(不经 API,同 topics 口径);交互件在 components/admin/pins。
 */
import Link from "next/link";

import { parseListSegment, parsePage } from "@/lib/admin/list";
import AdminPagination from "@/components/admin/AdminPagination";
import PinCreateButtons from "@/components/admin/pins/PinCreateButtons";
import PinsWorkbench from "@/components/admin/pins/PinsWorkbench";
import { requireAdminPage } from "@/lib/auth/guard";
import {
  PIN_LIST_SEGMENTS,
  PIN_LIST_PAGE_SIZE,
  PIN_STATUS_LABEL,
  type PinStatus,
} from "@/lib/pins/constants";
import { toPinListItemDto } from "@/lib/pins/dto";
import { countPinsByStatus, listPins } from "@/lib/pins/repo";

export const dynamic = "force-dynamic";

/** 流水线示意条(主流程:洞察→专题→agent→验收→同步→发布;静态导览) */
function PipeBar(): React.ReactElement {
  const steps: Array<[string, string]> = [
    ["数据中心", "发现选题"],
    ["创作中心", "绑定主题"],
    ["agent", "生成图 + 轻文字"],
    ["配图工坊", "人工精修"],
    ["公众号", "贴图草稿"],
    ["发布", "freepublish + /pins"],
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-line bg-panel px-4 py-2.5 font-mono text-[11px] text-text-3">
      {steps.map(([name, detail], i) => (
        <span key={name} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true">→</span>}
          <span className="text-text-2">
            {name} <b className="font-medium text-text-1">{detail}</b>
          </span>
        </span>
      ))}
      <span className="ml-auto hidden xl:inline">
        本页 = 组装与发布控制面,单图加工在「配图工坊」完成
      </span>
    </div>
  );
}

function segmentHref(segment: string): string {
  return segment === "all" ? "/admin/pins/" : `/admin/pins/?status=${segment}`;
}

export default async function AdminPinsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}) {
  await requireAdminPage();
  const sp = await searchParams;
  const segment = parseListSegment(PIN_LIST_SEGMENTS, sp.status, "all");
  const page = parsePage(sp.page);
  const q = sp.q?.trim() || undefined;
  const [{ items, total }, counts] = await Promise.all([
    listPins({
      status: segment === "all" ? undefined : (segment as PinStatus),
      page,
      q,
    }),
    countPinsByStatus(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PIN_LIST_PAGE_SIZE));
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">贴图管理</h1>
        <span className="text-[11px] text-text-3">
          公众号「小绿书」图片帖工作台 · 状态机留痕 · 图片引用配图工坊版本
        </span>
        <span className="ml-auto">
          <PinCreateButtons />
        </span>
      </div>

      <PipeBar />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PIN_LIST_SEGMENTS.map((s) => {
          const count = s === "all" ? allCount : (counts[s] ?? 0);
          return (
            <Link
              key={s}
              href={segmentHref(s)}
              className={`rounded-sm px-2.5 py-1 text-xs font-medium ${
                s === segment
                  ? "bg-accent/12 text-accent"
                  : "border border-line text-text-2 hover:text-text-1"
              }`}
            >
              {s === "all" ? "全部" : PIN_STATUS_LABEL[s]}
              {` ${count}`}
            </Link>
          );
        })}
        <form action="/admin/pins/" method="get" className="ml-auto flex items-center gap-1.5">
          {segment !== "all" && <input type="hidden" name="status" value={segment} />}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="按标题搜…"
            className="h-8 w-48 rounded-sm border border-line bg-panel px-2.5 text-xs text-text-1 outline-none placeholder:text-text-3 focus:border-accent"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-sm border border-line px-2.5 py-1.5 text-xs text-text-2 hover:text-accent"
          >
            搜索
          </button>
        </form>
      </div>

      <PinsWorkbench
        items={items.map(toPinListItemDto)}
        emptyHint={
          q
            ? "没有匹配的贴图——换个标题关键词试试"
            : "还没有贴图——右上角「新建贴图」或「AI 生成贴图」开始组装"
        }
      />

      {pages > 1 && (
        <AdminPagination
          page={page}
          totalPages={pages}
          total={total}
          hrefFor={(p) => {
            const params = new URLSearchParams();
            if (segment !== "all") params.set("status", segment);
            if (q) params.set("q", q);
            if (p > 1) params.set("page", String(p));
            const qs = params.toString();
            return qs ? `/admin/pins/?${qs}` : "/admin/pins/";
          }}
        />
      )}
    </div>
  );
}
