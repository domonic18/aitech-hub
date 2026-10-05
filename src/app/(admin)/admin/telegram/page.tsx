/**
 * 电报流治理页(M7 批④,侧栏「电报流治理」;原型 admin-telegram):
 * 四分段 + 来源/媒体/解读态筛选 + 搜索 + 分页;行内 恢复/隐藏/归档/编辑/解读;
 * 页尾屏蔽词管理。本件只做参数解析与取数编排,行/筛选栏/分页条在 components/admin。
 * M10 批⑤:解读态下拉(?ai=,存量视频以此导向行内「解读」按钮)。
 */
import BlocklistManager from "@/components/admin/BlocklistManager";
import AdminPagination from "@/components/admin/AdminPagination";
import TelegramFilterBar from "@/components/admin/TelegramFilterBar";
import TelegramItemRow from "@/components/admin/TelegramItemRow";
import { requireAdminPage } from "@/lib/auth/guard";
import { parseListSegment, parsePage } from "@/lib/admin/list";
import {
  TELEGRAM_AI_FILTERS,
  TELEGRAM_PAGE_SIZE,
  TELEGRAM_LIST_SEGMENTS,
  listTelegramAdmin,
  type TelegramAiFilter,
  type TelegramListSegment,
} from "@/lib/telegram/telegram-admin";
import { listBlocklist } from "@/lib/telegram/blocklist-admin";
import { FEED_MEDIA_FILTERS, type FeedMediaFilter } from "@/lib/telegram/feed-view";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    status?: string;
    page?: string;
    q?: string;
    source?: string;
    media?: string;
    blogger?: string;
    ai?: string;
  }>;
}

export default async function AdminTelegramPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const segment = parseListSegment(TELEGRAM_LIST_SEGMENTS, sp.status, "all");
  const page = parsePage(sp.page);
  const q = sp.q?.trim() || undefined;
  const sourceId = /^\d{1,10}$/.test(sp.source ?? "") ? Number(sp.source) : undefined;
  const media: FeedMediaFilter = FEED_MEDIA_FILTERS.includes(sp.media as FeedMediaFilter)
    ? (sp.media as FeedMediaFilter)
    : "all";
  const blogger = sp.blogger?.trim() || undefined;
  const aiFilter: TelegramAiFilter | undefined = TELEGRAM_AI_FILTERS.includes(
    sp.ai as TelegramAiFilter,
  )
    ? (sp.ai as TelegramAiFilter)
    : undefined;

  const { items, total, counts, sources } = await listTelegramAdmin({
    page,
    segment,
    sourceId,
    q,
    media,
    blogger,
    aiFilter,
  });
  const words = await listBlocklist();
  const totalPages = Math.max(1, Math.ceil(total / TELEGRAM_PAGE_SIZE));
  const href = (seg: TelegramListSegment, p: number, omit?: "blogger"): string => {
    const params = new URLSearchParams();
    if (seg !== "all") params.set("status", seg);
    if (q) params.set("q", q);
    if (sourceId !== undefined) params.set("source", String(sourceId));
    if (media !== "all") params.set("media", media);
    if (blogger && omit !== "blogger") params.set("blogger", blogger);
    if (aiFilter) params.set("ai", aiFilter);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/telegram/?${qs}` : "/admin/telegram/";
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">电报流治理</h2>
        <p className="mt-0.5 text-xs text-text-3">
          采集条目准入观测与人工干预:过滤命中以隐藏态落库,误杀在此恢复;归档退出前台时间轴。
        </p>
      </div>

      <TelegramFilterBar
        segment={segment}
        counts={counts}
        q={q}
        media={media}
        aiFilter={aiFilter}
        blogger={blogger}
        sourceRaw={sp.source}
        sources={sources}
        hrefFor={href}
      />

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">条目</th>
              <th className="px-3 py-2.5 font-medium">媒体</th>
              <th className="px-3 py-2.5 font-medium">来源</th>
              <th className="px-3 py-2.5 font-medium">过滤命中</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 font-medium">时间</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <TelegramItemRow key={t.id} item={t} />
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-text-3">
                  没有符合条件的条目
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <AdminPagination
          page={page}
          totalPages={totalPages}
          total={total}
          hrefFor={(p) => href(segment, p)}
        />
      </div>

      <BlocklistManager
        words={words.map((w) => ({
          id: w.id,
          word: w.word,
          scope: w.scope,
          hitCount: w.hitCount,
          enabled: w.enabled,
        }))}
      />

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:屏蔽词与启发式只影响新条目准入;隐藏/归档为人工终审动作,恢复即回前台。 命中规则计入
        filter_hit 不回溯。API:PUT /api/telegram/[id] · GET/POST /api/blocklist · PUT/DELETE
        /api/blocklist/[id]。
      </p>
    </div>
  );
}
