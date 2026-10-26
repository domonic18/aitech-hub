/**
 * 配图工坊列表页(M40 验收反馈补:后台固定入口):根版本(原始整图)倒序
 * 网格,点选进编辑器 /admin/illustration/[id]。工坊是 agent 配图的下游
 * 加工台——generate_illustration 出图即登记根版本,本页为其浏览面;
 * 侧栏「创作·配图工坊」落地此页(IA v2)。
 * F13 对齐批(2026-10-23):两行结构(pageHead 标题行 / toolbar 搜索+图库行);
 * 3 列信息卡=链尾最新版本图 + 名称行(prompt 派生,兜底「配图 #id」)+
 * 「vN · MM-DD · N 层」meta(链长/链尾日期/链尾最新组图层数);点卡进链尾
 * 版本编辑器(非根)。搜索 ?q= 对 name/mediaPath 双列 contains。
 */
import Link from "next/link";

import IllustrationCreateButton from "@/components/admin/illustration/IllustrationCreateButton";
import SampleLibraryButton from "@/components/admin/illustration/SampleLibraryButton";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDate } from "@/lib/datetime";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const LIST_TAKE = 50;

/** 卡面取数中间态:根版本 + 链长 + 链尾(最新版本)+ 链尾最新组图层数 */
interface IlluCardView {
  id: bigint;
  name: string | null;
  mediaPath: string;
  tailId: bigint;
  tailMediaPath: string;
  chainLen: number;
  tailDate: Date;
  layerCount: number;
}

/** 链节点最小投影(roots 全行与 select 子集结构兼容) */
interface ChainNode {
  id: bigint;
  mediaPath: string;
  createdAt: Date;
}

export default async function AdminIllustrationListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const q = (await searchParams).q?.trim() ?? "";
  const roots = await prisma.illustrationVersion.findMany({
    where: {
      parentVersionId: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { mediaPath: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: LIST_TAKE,
  });

  // 内存建链(BFS 沿 parent 层层拉子版本,链深=编辑次数量级 <20);
  // 分叉时(理论可从旧版本再编辑)沿 createdAt 最新子延续,与编辑器链口径一致
  const childrenOf = new Map<string, ChainNode[]>();
  let frontier = roots.map((r) => r.id);
  while (frontier.length > 0) {
    const children = await prisma.illustrationVersion.findMany({
      where: { parentVersionId: { in: frontier } },
      select: { id: true, mediaPath: true, parentVersionId: true, createdAt: true },
    });
    if (children.length === 0) break;
    for (const c of children) {
      const key = String(c.parentVersionId);
      const bucket = childrenOf.get(key);
      if (bucket) bucket.push(c);
      else childrenOf.set(key, [c]);
    }
    frontier = children.map((c) => c.id);
  }

  function nextOf(id: bigint): ChainNode | undefined {
    const bucket = childrenOf.get(String(id));
    if (!bucket || bucket.length === 0) return undefined;
    return bucket.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  }

  // 链尾集合一次取最新组(含 _count layers),内存按版本分组取 createdAt 最新
  const tails = roots.map((r) => {
    let cur: ChainNode = r;
    let len = 1;
    for (let nxt = nextOf(cur.id); nxt; nxt = nextOf(cur.id)) {
      cur = nxt;
      len += 1;
    }
    return { root: r, tail: cur, chainLen: len };
  });
  const tailIds = tails.map((t) => t.tail.id);
  const groups = await prisma.illustrationLayerGroup.findMany({
    where: { versionId: { in: tailIds } },
    orderBy: { createdAt: "desc" },
    select: { versionId: true, _count: { select: { layers: true } } },
  });
  const layerCountOf = new Map<string, number>();
  for (const g of groups) {
    const key = String(g.versionId);
    if (!layerCountOf.has(key)) layerCountOf.set(key, g._count.layers);
  }

  const cards: IlluCardView[] = tails.map(({ root, tail, chainLen }) => ({
    id: root.id,
    name: root.name,
    mediaPath: root.mediaPath,
    tailId: tail.id,
    tailMediaPath: tail.mediaPath,
    chainLen,
    tailDate: tail.createdAt,
    layerCount: layerCountOf.get(String(tail.id)) ?? 0,
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* pageHead 行(板 18:462):标题 + 功能 hint + 新建按钮 */}
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-sm font-medium text-text-1">配图工坊</h1>
        <span className="text-[11px] text-text-3">AI 拆层编辑 · 产出落媒体库,文章经插入器引用</span>
        <span className="ml-auto">
          <IllustrationCreateButton />
        </span>
      </div>

      {/* toolbar 行(板:搜索左,样例图库右) */}
      <div className="flex items-center gap-2">
        {/* 原生 GET 表单(零 JS):提交即 ?q= 服务端过滤 */}
        <form action="/admin/illustration" className="flex">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="搜索文件名…"
            aria-label="搜索配图名称或文件名"
            className="w-44 rounded-sm border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-text-1 outline-none placeholder:text-text-3 focus:border-accent"
          />
        </form>
        <span className="ml-auto">
          <SampleLibraryButton />
        </span>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-md border border-line bg-panel px-4 py-10 text-center text-xs text-text-3">
          {q
            ? `没有匹配「${q}」的配图——换个关键词,或清空搜索看全部。`
            : "还没有配图版本——打开悬浮 AI 助手让它为文章配图,出图后此处即出现可加工的原图。"}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {cards.map((c) => (
            <Link
              key={c.id}
              href={`/admin/illustration/${c.tailId}/`}
              className="overflow-hidden rounded-sm border border-line bg-panel transition-colors hover:border-line-hover"
              title={c.name ?? `配图 #${c.id}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部缩略,src 为站内媒体路径 */}
              <img
                src={c.tailMediaPath}
                alt={c.name ?? `配图 #${c.id}`}
                loading="lazy"
                className="h-[100px] w-full object-cover"
              />
              <div className="flex flex-col gap-0.5 px-2.5 py-2">
                <span className="truncate text-[11.5px] font-medium text-text-1">
                  {c.name ?? `配图 #${c.id}`}
                </span>
                <span className="font-mono text-[10.5px] text-text-3">
                  v{c.chainLen} · {formatCnDate(c.tailDate).slice(5)} · {c.layerCount} 层
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {cards.length > 0 && (
        <p className="text-[11px] text-text-3">
          {q
            ? `匹配「${q}」共 ${cards.length} 张`
            : `共 ${cards.length} 张${cards.length >= LIST_TAKE ? "(仅显最近 50 条)" : ""} · 根版本缩略 · 上限 50 条 · 点卡片进入编辑器`}
        </p>
      )}
    </div>
  );
}
