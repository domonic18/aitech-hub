/**
 * 创作中心详情(M42:自专题详情泛化,四区叙事 = 端到端创作流程)——
 * ① 创作概览:状态步进条 + 标题 + 事实行(主意图/长文/贴图计数)+ 人工流转;
 * ② 创作配置:页签「长文配置」(MECE 四维 + 样例参照图)/「贴图配置」
 *   (张数/比例/裁剪/风格 + 参照图轨);两套配置独立列互不派生;
 * ③ 素材:已挂素材卡(视频/电报文本/文章分型)+ 页内从库添加(searchParams
 *   驱动服务端渲染:视频仅 aiStatus=done、文本需可见且有内容、文章按标题搜);
 * ④ 产出:长文卡 + 贴图列表 + 恒有「生成长文 / 生成贴图」两个动作(体裁词由
 *   服务端 resolvePurpose 从长文配置派生——配置单点,无双入口漂移)。
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { parsePage } from "@/lib/admin/list";
import { requireAdminPage } from "@/lib/auth/guard";
import { listPinsByTopic } from "@/lib/pins/repo";
import { needsRecomposeConfirm } from "@/lib/topics/compose";
import { TOPIC_OUTPUT_LABEL, type TopicOutputType } from "@/lib/topics/constants";
import {
  MOUNT_PAGE_SIZE,
  hydrateItems,
  listPostCandidates,
  listTelegramCandidates,
} from "@/lib/topics/materials";
import { resolveTopicReferences } from "@/lib/topics/references";
import { getLinkedDocDetail, getLinkedPostState, getTopic } from "@/lib/topics/repo";
import {
  parsePinWritingText,
  PIN_ASPECT_LABEL,
  PIN_CROP_LABEL,
} from "@/lib/topics/writing-pin-config";
import { resolvePurpose } from "@/lib/topics/writing-config";

import AdminPagination from "@/components/admin/AdminPagination";
import ArticleOutputCard from "@/components/admin/studio/ArticleOutputCard";
import MaterialCards from "@/components/admin/studio/MaterialCards";
import PinConfigPanel from "@/components/admin/studio/PinConfigPanel";
import PinOutputsPanel from "@/components/admin/studio/PinOutputsPanel";
import StudioActions from "@/components/admin/studio/StudioActions";
import StudioConfigTabs from "@/components/admin/studio/StudioConfigTabs";
import TopicMountButton from "@/components/admin/studio/TopicMountButton";
import TopicMountControls from "@/components/admin/studio/TopicMountControls";
import TopicOverviewPanel from "@/components/admin/studio/TopicOverviewPanel";
import TopicPersistDetails from "@/components/admin/studio/TopicPersistDetails";
import TopicSampleImagePicker from "@/components/admin/studio/TopicSampleImagePicker";
import TopicWritingConfigPanel from "@/components/admin/studio/TopicWritingConfigPanel";

export const dynamic = "force-dynamic";

const ID_RE = /^\d{1,10}$/;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mount?: string; q?: string; page?: string }>;
}

export default async function AdminStudioDetailPage({ params, searchParams }: PageProps) {
  await requireAdminPage();
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();
  const topic = await getTopic(BigInt(id)).catch(() => null);
  if (!topic) notFound();

  const materials = await hydrateItems(topic.items);
  const [linkedPost, linkedDoc, pins, references] = await Promise.all([
    topic.linkedPostId ? getLinkedPostState(topic.linkedPostId) : Promise.resolve(null),
    topic.linkedPostId ? getLinkedDocDetail(topic.linkedPostId) : Promise.resolve(null),
    listPinsByTopic(topic.id),
    // 详情页渲染不发起外链转存(视频封面层留给生成期 agent 转存后进入候选)
    resolveTopicReferences(topic),
  ]);

  // 内容形式/体裁词:服务端从落库写作要求单点派生(概览展示 + 生成话术同源)
  const purpose = resolvePurpose(topic.positioning);
  const hasLongFormConfig = (topic.positioning ?? "").trim() !== "";
  const pinParsed = parsePinWritingText(topic.pinPositioning);
  const pinHint =
    `出 ${pinParsed.selection.count} 张 · ${PIN_ASPECT_LABEL[pinParsed.selection.aspect]}` +
    ` · 首图 ${PIN_CROP_LABEL[pinParsed.selection.crop]}` +
    (pinParsed.selection.reference ? " · 指定参照图" : " · 参照图自动");

  const sp = await searchParams;
  const tab = sp.mount === "post" ? "post" : "telegram";
  const q = sp.q?.trim() || undefined;
  const page = parsePage(sp.page);
  const candidates =
    tab === "post" ? await listPostCandidates(q, page) : await listTelegramCandidates(q, page);
  // 已添加判定键含 itemType:视频/文本与文章 id 各自成序,裸数字会互相误撞
  const mountedKeys = new Set(topic.items.map((i) => `${i.itemType}:${i.itemId}`));
  const mountPages = Math.max(1, Math.ceil(candidates.total / MOUNT_PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 text-xs text-text-3">
        <Link href="/admin/studio/" className="hover:text-accent">
          ← 创作中心
        </Link>
      </div>

      {/* ① 创作概览:到哪一步、接下来做什么(状态可视化 + 标题 + 事实行 + 流转) */}
      <TopicOverviewPanel
        id={id}
        title={topic.title}
        status={topic.status}
        outputLabel={TOPIC_OUTPUT_LABEL[topic.outputType as TopicOutputType] ?? topic.outputType}
        linkedPostId={topic.linkedPostId?.toString() ?? null}
        pinCount={pins.length}
        purposeLabel={purpose.label}
        purposeCustom={purpose.custom}
        showPurpose={hasLongFormConfig || topic.outputType === "article"}
        createdAt={topic.createdAt}
        updatedAt={topic.updatedAt}
        composedAt={topic.composedAt}
        publishedAt={topic.publishedAt}
      />

      {/* ② 创作配置:长文/贴图两套独立配置,页签切换不卸载(未保存内容不丢) */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-text-1">创作配置</h2>
      <StudioConfigTabs
        defaultTab={topic.outputType === "pin" ? "pin" : "writing"}
        writing={
          <div className="flex flex-col gap-2">
            <TopicWritingConfigPanel id={id} positioning={topic.positioning} />
            {/* 配图风格参照(M39 批③):样例图库绑定面,绑定即时生效不经保存按钮 */}
            <TopicSampleImagePicker
              topicId={id}
              initialSampleImageId={topic.sampleImageId?.toString() ?? null}
            />
          </div>
        }
        pin={
          <PinConfigPanel id={id} pinPositioning={topic.pinPositioning} candidates={references} />
        }
      />

      {/* ③ 素材(先收料):零素材时素材库默认展开引导 */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-text-1">素材({topic.items.length})</h2>
      <MaterialCards topicId={id} items={topic.items} materials={materials} />

      {/* 从库添加素材(§8:详情页内选挂;开合态客户端持有防 refresh 塌缩) */}
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
                            ? c.mediaType === "video"
                              ? [c.videoBlogger, c.aiSummary].filter(Boolean).join(" · ")
                              : ["电报图文", c.summary].filter(Boolean).join(" · ")
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
                      {tab === "telegram"
                        ? "没有匹配的电报素材(视频仅已解读条目可添加,文本需可见且有内容)"
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
                return `/admin/studio/${id}/?${params.toString()}`;
              }}
            />
          )}
        </div>
      </TopicPersistDetails>

      {/* ④ 产出:长文 + 贴图,动作区恒有两个入口(主意图不限制产出类型) */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-text-1">产出</h2>
      <div className="flex flex-col gap-2">
        {topic.linkedPostId && linkedDoc ? (
          <ArticleOutputCard postId={topic.linkedPostId.toString()} doc={linkedDoc} />
        ) : (
          <p className="rounded-sm border border-dashed border-line px-3 py-4 text-[12px] text-text-3">
            还没有长文——点「生成长文」后,文档会出现在这里,可打开人工定稿
          </p>
        )}
        <PinOutputsPanel pins={pins} />
        <StudioActions
          topicId={id}
          topicTitle={topic.title}
          materialsCount={topic.items.length}
          hasDoc={topic.linkedPostId !== null}
          linkedPostStatus={linkedPost?.status ?? null}
          editedSinceCompose={linkedPost ? needsRecomposeConfirm(topic, linkedPost) : false}
          genreWord={purpose.genreWord}
          hasPins={pins.length > 0}
          pinHint={pinHint}
        />
      </div>
    </div>
  );
}
