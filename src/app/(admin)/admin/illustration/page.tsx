/**
 * 配图工坊列表页(M40 验收反馈补:后台固定入口):根版本(原始整图)倒序
 * 网格,点选进编辑器 /admin/illustration/[id]。工坊是 agent 配图的下游
 * 加工台——generate_illustration 出图即登记根版本,本页为其浏览面;
 * 侧栏「内容管理·配图工坊」落地此页。
 */
import Link from "next/link";

import { ORIGIN_BADGE_CLS, ORIGIN_LABEL } from "@/components/admin/illustration/labels";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const LIST_TAKE = 50;

export default async function AdminIllustrationListPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const roots = await prisma.illustrationVersion.findMany({
    where: { parentVersionId: null },
    orderBy: { createdAt: "desc" },
    take: LIST_TAKE,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-sm font-medium text-text-1">配图工坊</h1>
        <span className="text-[11px] text-text-3">
          共 {roots.length} 张{roots.length >= LIST_TAKE ? "(仅显最近 50)" : ""} · agent
          配图出图即登记,点选进入拆层/改字/导出
        </span>
      </div>

      {roots.length === 0 ? (
        <div className="rounded-md border border-line bg-panel px-4 py-10 text-center text-xs text-text-3">
          还没有配图版本——打开悬浮 AI 助手让它为文章配图,出图后此处即出现可加工的原图。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {roots.map((v) => (
            <Link
              key={v.id}
              href={`/admin/illustration/${v.id}/`}
              className="overflow-hidden rounded-sm border border-line bg-panel transition-colors hover:border-line-hover"
              title={`配图 #${v.id}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部缩略,src 为站内媒体路径 */}
              <img
                src={v.mediaPath}
                alt={`配图 #${v.id}`}
                loading="lazy"
                className="h-28 w-full object-cover"
              />
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <span className="font-mono text-[10px] text-text-3">#{v.id}</span>
                <span
                  className={`rounded-sm px-1.5 py-0.5 text-[10px] ${ORIGIN_BADGE_CLS[v.origin] ?? ORIGIN_BADGE_CLS.original}`}
                >
                  {ORIGIN_LABEL[v.origin] ?? v.origin}
                </span>
                <span className="ml-auto text-[10px] text-text-3">
                  {formatCnDateTime(new Date(v.createdAt))}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
