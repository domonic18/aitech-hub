/**
 * 专题详情(M26 批③④,方案 §8 详情三区):① 定位区(标题/定位/关联文章 +
 * 人工状态流转);② 素材区(电报卡:标题/博主/短结论/解读笔记全文/批注内联
 * 编辑;文章卡)+ 页内挂载选料(searchParams 驱动服务端渲染:电报仅
 * aiStatus=done,文章按标题搜);③ 合成操作区(合成初稿/重合成/跳转文档,
 * 重合成保护预判提示)。数据服务端直取 repo。
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { parsePage } from "@/lib/admin/list";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { needsRecomposeConfirm } from "@/lib/topics/compose";
import { MOUNT_PAGE_SIZE, type TopicItemMaterial } from "@/lib/topics/repo";
import {
  getLinkedPostState,
  getTopic,
  hydrateItems,
  listPostCandidates,
  listTelegramCandidates,
} from "@/lib/topics/repo";

import AdminPagination from "@/components/admin/AdminPagination";
import TopicComposeActions from "@/components/admin/topics/TopicComposeActions";
import TopicItemActions from "@/components/admin/topics/TopicItemActions";
import TopicMetaPanel from "@/components/admin/topics/TopicMetaPanel";
import TopicMountButton from "@/components/admin/topics/TopicMountButton";
import TopicMountControls from "@/components/admin/topics/TopicMountControls";

export const dynamic = "force-dynamic";

const ID_RE = /^\d{1,10}$/;

/** 解读笔记全文折叠块(纯文本保形渲染:## 行升格小标题,其余原样换行;
 * 不走 HTML 管线——LLM 产物零注入面) */
function NoteBlock({ note }: { note: string }) {
  return (
    <details className="mt-1.5 rounded-sm bg-panel-2/60 px-2.5 py-1.5">
      <summary className="cursor-pointer text-xs text-text-2 hover:text-text-1">
        解读笔记({note.length} 字)
      </summary>
      <div className="mt-1.5 text-[12px] leading-relaxed text-text-2">
        {note.split("\n").map((line, i) =>
          line.startsWith("## ") ? (
            <h3 key={i} className="mt-2 font-semibold text-text-1 first:mt-0">
              {line.slice(3)}
            </h3>
          ) : (
            <p key={i} className="whitespace-pre-wrap">
              {line}
            </p>
          ),
        )}
      </div>
    </details>
  );
}

function TelegramCard({
  topicId,
  material,
  note,
  itemId,
}: {
  topicId: string;
  material: NonNullable<TopicItemMaterial["telegram"]>;
  note: string | null;
  itemId: bigint;
}) {
  return (
    <div className="rounded-sm border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-text-1">
            {material.title ?? "(无标题)"}
          </div>
          <div className="mt-0.5 text-[11px] text-text-3">
            {material.videoBlogger ?? "未知博主"} ·{" "}
            <a href={material.url} target="_blank" rel="noreferrer" className="hover:text-accent">
              原视频
            </a>
          </div>
        </div>
        <TopicItemActions topicId={topicId} itemId={itemId.toString()} note={note} />
      </div>
      {material.aiSummary && (
        <p className="mt-1.5 line-clamp-2 text-[12px] text-text-2">
          <span className="text-text-3">短结论:</span>
          {material.aiSummary}
        </p>
      )}
      {material.aiNote ? (
        <NoteBlock note={material.aiNote} />
      ) : (
        <p className="mt-1 text-[11px] text-text-3">
          无解读笔记(存量或降级轮次,合成时自动降级拼装)
        </p>
      )}
    </div>
  );
}

function PostCard({
  topicId,
  material,
  note,
  itemId,
}: {
  topicId: string;
  material: NonNullable<TopicItemMaterial["post"]>;
  note: string | null;
  itemId: bigint;
}) {
  return (
    <div className="rounded-sm border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/admin/posts/${material.id.toString()}`}
            className="truncate text-[13px] font-medium text-text-1 hover:text-accent"
          >
            {material.title}
          </Link>
          <div className="mt-0.5 text-[11px] text-text-3">
            文章 · {material.status === "published" ? "已发布" : "草稿"}
          </div>
        </div>
        <TopicItemActions topicId={topicId} itemId={itemId.toString()} note={note} />
      </div>
    </div>
  );
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mount?: string; q?: string; page?: string }>;
}

export default async function AdminTopicDetailPage({ params, searchParams }: PageProps) {
  await requireAdminPage();
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();
  const topic = await getTopic(BigInt(id)).catch(() => null);
  if (!topic) notFound();
  const materials = await hydrateItems(topic.items);
  const linkedPost = topic.linkedPostId ? await getLinkedPostState(topic.linkedPostId) : null;

  const sp = await searchParams;
  const tab = sp.mount === "post" ? "post" : "telegram";
  const q = sp.q?.trim() || undefined;
  const page = parsePage(sp.page);
  const candidates =
    tab === "post" ? await listPostCandidates(q, page) : await listTelegramCandidates(q, page);
  // 已挂判定键含 itemType:电报与文章 id 各自成序,裸数字会互相误撞
  const mountedKeys = new Set(topic.items.map((i) => `${i.itemType}:${i.itemId}`));
  const mountPages = Math.max(1, Math.ceil(candidates.total / MOUNT_PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 text-xs text-text-3">
        <Link href="/admin/topics/" className="hover:text-accent">
          ← 专题管理
        </Link>
      </div>

      {/* ① 定位区 */}
      <TopicMetaPanel
        id={id}
        title={topic.title}
        positioning={topic.positioning}
        linkedPostId={topic.linkedPostId?.toString() ?? null}
        status={topic.status}
      />
      <div className="mt-1 text-[11px] text-text-3">
        创建于 {formatCnDateTime(topic.createdAt)} · 更新于 {formatCnDateTime(topic.updatedAt)}
        {topic.composedAt && ` · 最近合成 ${formatCnDateTime(topic.composedAt)}`}
        {topic.publishedAt && ` · 关联文章发布 ${formatCnDateTime(topic.publishedAt)}`}
      </div>

      {/* ③ 合成操作区(批④:重合成保护在服务端 409 二次确认,这里仅提示预判) */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-text-1">合成</h2>
      <TopicComposeActions
        topicId={id}
        linkedPostId={topic.linkedPostId?.toString() ?? null}
        linkedPostStatus={linkedPost?.status ?? null}
        editedSinceCompose={linkedPost ? needsRecomposeConfirm(topic, linkedPost) : false}
      />

      {/* ② 素材区 */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-text-1">素材({topic.items.length})</h2>
      <div className="flex flex-col gap-2">
        {topic.items.map((item) => {
          const material = materials.get(item.id);
          return (
            <div key={item.id.toString()}>
              {material?.telegram && (
                <TelegramCard
                  topicId={id}
                  material={material.telegram}
                  note={item.note}
                  itemId={item.id}
                />
              )}
              {material?.post && (
                <PostCard topicId={id} material={material.post} note={item.note} itemId={item.id} />
              )}
              {!material?.telegram && !material?.post && (
                <div className="rounded-sm border border-line p-3 text-[12px] text-text-3">
                  素材已不存在(源条目被删),建议卸载
                  <span className="ml-2">
                    <TopicItemActions topicId={id} itemId={item.id.toString()} note={item.note} />
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {topic.items.length === 0 && (
          <p className="rounded-sm border border-dashed border-line px-3 py-6 text-center text-[12px] text-text-3">
            尚未挂载素材——下方选料挂入 2~3 条解读(合成素材深度取决于解读笔记)
          </p>
        )}
      </div>

      {/* 挂载选料(§8:详情页内选挂;电报流仅已解读) */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-text-1">挂载素材</h2>
      <TopicMountControls topicId={id} tab={tab} q={q ?? ""} />
      {/* 摘要列 w-full max-w-0:line-clamp 单行在表格自动布局下 min-content 不可缩,
          会把操作列顶出视口且外层裁剪不可滚(1276 验收发现);max-w-0 让钳制真正生效 */}
      <div className="mt-2 overflow-x-auto rounded-sm border border-line">
        <table className="w-full text-left text-[13px]">
          <tbody>
            {candidates.items.map((c) => {
              const mounted = mountedKeys.has(`${tab}:${c.id}`);
              return (
                <tr key={c.id.toString()} className="border-t border-line first:border-t-0">
                  <td className="w-full max-w-0 px-3 py-2">
                    <div className="truncate text-text-1">{c.title || "(无标题)"}</div>
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-text-3">
                      {"videoBlogger" in c
                        ? [c.videoBlogger, c.aiSummary].filter(Boolean).join(" · ")
                        : c.status === "published"
                          ? "已发布"
                          : "草稿"}
                    </div>
                  </td>
                  <td className="w-20 px-3 py-2 text-right align-middle">
                    {mounted ? (
                      <span className="text-[11px] text-text-3">已在本专题</span>
                    ) : (
                      <TopicMountButton topicId={id} itemType={tab} itemId={c.id.toString()} />
                    )}
                  </td>
                </tr>
              );
            })}
            {candidates.items.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-[12px] text-text-3" colSpan={2}>
                  {tab === "telegram"
                    ? "没有匹配的已解读视频(仅 aiStatus=done 的条目可挂)"
                    : "没有匹配的文章"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {mountPages > 1 && (
        <AdminPagination
          page={page}
          totalPages={mountPages}
          total={candidates.total}
          hrefFor={(p) => {
            const params = new URLSearchParams();
            params.set("mount", tab);
            if (q) params.set("q", q);
            if (p > 1) params.set("page", String(p));
            return `/admin/topics/${id}/?${params.toString()}`;
          }}
        />
      )}
    </div>
  );
}
