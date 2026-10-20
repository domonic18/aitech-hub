/**
 * 专题详情(2026-10-20 验收反馈详情页重构:四区叙事 = 工作流走向,去「合成」
 * 术语,单一真相源)——① 专题概览:状态步进条 + 标题 + 事实行(内容形式/关联
 * 文章/时间线)+ 当前态语义与人工流转;② 写作要求:MECE 四维可视化构建(内容
 * 形式 × 口吻 × 篇幅 × 配图,带样例与信息卡真实渲染预览,落库 positioning);
 * ③ 素材:已添加素材卡(批注内联编辑)+ 页内从库添加(searchParams 驱动服务端
 * 渲染:视频仅 aiStatus=done,文章按标题搜;零素材时默认展开引导);④ 初稿:
 * 文档状态卡(公众号同步快照)+ 生成初稿(体裁词由服务端 resolvePurpose 从
 * 写作要求派生——配置单点,无双入口漂移)。
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { parsePage } from "@/lib/admin/list";
import { requireAdminPage } from "@/lib/auth/guard";
import { needsRecomposeConfirm } from "@/lib/topics/compose";
import { MOUNT_PAGE_SIZE, type TopicItemMaterial } from "@/lib/topics/repo";
import {
  getLinkedDocDetail,
  getLinkedPostState,
  getTopic,
  hydrateItems,
  listPostCandidates,
  listTelegramCandidates,
} from "@/lib/topics/repo";
import { resolvePurpose } from "@/lib/topics/writing-config";

import AdminPagination from "@/components/admin/AdminPagination";
import TopicDraftActions from "@/components/admin/topics/TopicDraftActions";
import TopicItemActions from "@/components/admin/topics/TopicItemActions";
import TopicLinkedDocCard from "@/components/admin/topics/TopicLinkedDocCard";
import TopicMountButton from "@/components/admin/topics/TopicMountButton";
import TopicMountControls from "@/components/admin/topics/TopicMountControls";
import TopicOverviewPanel from "@/components/admin/topics/TopicOverviewPanel";
import TopicPersistDetails from "@/components/admin/topics/TopicPersistDetails";
import TopicWritingConfigPanel from "@/components/admin/topics/TopicWritingConfigPanel";

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
          无解读笔记(存量或降级轮次,生成初稿时自动降级拼装)
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
  const linkedDoc = topic.linkedPostId ? await getLinkedDocDetail(topic.linkedPostId) : null;
  // 内容形式/体裁词:服务端从落库写作要求单点派生(概览展示 + 生成话术同源)
  const purpose = resolvePurpose(topic.positioning);

  const sp = await searchParams;
  const tab = sp.mount === "post" ? "post" : "telegram";
  const q = sp.q?.trim() || undefined;
  const page = parsePage(sp.page);
  const candidates =
    tab === "post" ? await listPostCandidates(q, page) : await listTelegramCandidates(q, page);
  // 已添加判定键含 itemType:视频与文章 id 各自成序,裸数字会互相误撞
  const mountedKeys = new Set(topic.items.map((i) => `${i.itemType}:${i.itemId}`));
  const mountPages = Math.max(1, Math.ceil(candidates.total / MOUNT_PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 text-xs text-text-3">
        <Link href="/admin/topics/" className="hover:text-accent">
          ← 专题管理
        </Link>
      </div>

      {/* ① 专题概览:到哪一步、接下来做什么(状态可视化 + 标题 + 事实行 + 流转) */}
      <TopicOverviewPanel
        id={id}
        title={topic.title}
        status={topic.status}
        linkedPostId={topic.linkedPostId?.toString() ?? null}
        purposeLabel={purpose.label}
        purposeCustom={purpose.custom}
        createdAt={topic.createdAt}
        updatedAt={topic.updatedAt}
        composedAt={topic.composedAt}
        publishedAt={topic.publishedAt}
      />

      {/* ② 写作要求:四维可视化构建(选择合成文本,textarea 唯一真相源) */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-text-1">写作要求</h2>
      <TopicWritingConfigPanel id={id} positioning={topic.positioning} />

      {/* ③ 素材(先收料):零素材时素材库默认展开引导 */}
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
                  素材已不存在(源条目被删),建议移除
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
            还没有素材——从下方素材库添加 2~3 条解读(生成初稿的质量取决于解读笔记)
          </p>
        )}
      </div>

      {/* 从库添加素材(§8:详情页内选挂;视频仅已解读;开合态客户端持有防 refresh 塌缩) */}
      <TopicPersistDetails defaultOpen={topic.items.length === 0} summary="从库中添加素材">
        <div className="mt-2 flex flex-col gap-2">
          <TopicMountControls topicId={id} tab={tab} q={q ?? ""} />
          {/* 摘要列 w-full max-w-0:line-clamp 单行在表格自动布局下 min-content 不可缩,
              会把操作列顶出视口且外层裁剪不可滚(1276 验收发现);max-w-0 让钳制真正生效 */}
          <div className="overflow-x-auto rounded-sm border border-line">
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
                          <span className="text-[11px] text-text-3">已添加</span>
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
                      {tab === "telegram" ? "没有匹配的视频(仅已解读条目可添加)" : "没有匹配的文章"}
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
      </TopicPersistDetails>

      {/* ④ 初稿(后出稿):文档落点可视化 + 生成动作(体裁词由写作要求派生;
          覆盖确认在服务端工具 needConfirm → agent ask_user 回路) */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-text-1">初稿</h2>
      <div className="flex flex-col gap-2">
        {topic.linkedPostId && linkedDoc ? (
          <TopicLinkedDocCard postId={topic.linkedPostId.toString()} doc={linkedDoc} />
        ) : (
          <p className="rounded-sm border border-dashed border-line px-3 py-4 text-[12px] text-text-3">
            还没有初稿——点「生成初稿」后,文档会出现在这里,可打开人工定稿
          </p>
        )}
        <TopicDraftActions
          topicId={id}
          topicTitle={topic.title}
          materialsCount={topic.items.length}
          hasDoc={topic.linkedPostId !== null}
          linkedPostStatus={linkedPost?.status ?? null}
          editedSinceCompose={linkedPost ? needsRecomposeConfirm(topic, linkedPost) : false}
          genreWord={purpose.genreWord}
        />
      </div>
    </div>
  );
}
