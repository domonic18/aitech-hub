/**
 * 创作中心详情(v2 工作台三栏重构)——顶栏(返回/标题编辑/状态流转)+
 * 三栏工作台:左素材栏(紧凑卡 + 添加素材弹层)/中舞台(长文|贴图 页签 +
 * 产出内容 + 底部创作条「生成长文/生成贴图」恒在)/右配置栏(随页签联动:
 * 长文=四维写作要求+样例图,贴图=张数/比例/裁剪/风格+参照图轨;两套配置
 * 独立列互不派生)。取数与 M42 一致:服务端直取 repo,弹层候选由
 * searchParams 驱动(?mount/q/page)。
 */
import { notFound } from "next/navigation";

import { parsePage } from "@/lib/admin/list";
import { requireAdminPage } from "@/lib/auth/guard";
import { listPinsByTopic } from "@/lib/pins/repo";
import { needsRecomposeConfirm } from "@/lib/topics/compose";
import { TOPIC_OUTPUT_LABEL, type TopicOutputType } from "@/lib/topics/constants";
import type { GenerationBaseline } from "@/lib/topics/generation-state";
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
import MaterialRail from "@/components/admin/studio/MaterialRail";
import PinConfigPanel from "@/components/admin/studio/PinConfigPanel";
import PinOutputsGrid from "@/components/admin/studio/PinOutputsGrid";
import StageGuideCard from "@/components/admin/studio/StageGuideCard";
import StageStateGate from "@/components/admin/studio/StageStateGate";
import StudioActions from "@/components/admin/studio/StudioActions";
import StudioGenerationProvider from "@/components/admin/studio/StudioGenerationProvider";
import StudioMaterialModal from "@/components/admin/studio/StudioMaterialModal";
import StudioTopbar from "@/components/admin/studio/StudioTopbar";
import StudioWorkbench from "@/components/admin/studio/StudioWorkbench";
import TopicMountButton from "@/components/admin/studio/TopicMountButton";
import TopicMountControls from "@/components/admin/studio/TopicMountControls";
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

  // 内容形式/体裁词:服务端从落库写作要求单点派生(生成话术同源,无双入口)
  const purpose = resolvePurpose(topic.positioning);
  const pinParsed = parsePinWritingText(topic.pinPositioning);
  const pinHint =
    `出 ${pinParsed.selection.count} 张 · ${PIN_ASPECT_LABEL[pinParsed.selection.aspect]}` +
    ` · 首图 ${PIN_CROP_LABEL[pinParsed.selection.crop]}` +
    (pinParsed.selection.reference ? " · 指定参照图" : " · 参照图自动");

  // 生成态基线(M44):点击生成时随 StudioActions 下发,轮询据此判定落库完成
  const baseline: GenerationBaseline = {
    status: topic.status,
    updatedAt: topic.updatedAt.toISOString(),
    linkedPostId: topic.linkedPostId ? topic.linkedPostId.toString() : null,
    pinIds: pins.map((p) => p.id.toString()),
  };

  const sp = await searchParams;
  const tab = sp.mount === "post" ? "post" : "telegram";
  const q = sp.q?.trim() || undefined;
  const page = parsePage(sp.page);
  const candidates =
    tab === "post" ? await listPostCandidates(q, page) : await listTelegramCandidates(q, page);
  // 已添加判定键含 itemType:视频/文本与文章 id 各自成序,裸数字会互相误撞
  const mountedKeys = new Set(topic.items.map((i) => `${i.itemType}:${i.itemId}`));
  const mountPages = Math.max(1, Math.ceil(candidates.total / MOUNT_PAGE_SIZE));

  const materialModal = (
    <StudioMaterialModal defaultOpen={sp.mount !== undefined}>
      <div className="flex flex-col gap-2">
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
    </StudioMaterialModal>
  );

  return (
    <div className="mx-auto max-w-[1500px]">
      {/* 顶栏:返回 + 标题编辑 + 状态徽标/流转 + 当前态语义与时间线 */}
      <StudioTopbar
        id={id}
        title={topic.title}
        status={topic.status}
        outputLabel={TOPIC_OUTPUT_LABEL[topic.outputType as TopicOutputType] ?? topic.outputType}
        createdAt={topic.createdAt}
        updatedAt={topic.updatedAt}
      />

      {/* 生成态 Provider(M44):包整个工作台,舞台门/创作条/产出网格共享在途与完成态 */}
      <StudioGenerationProvider topicId={id}>
        <StudioWorkbench
          defaultTab={topic.outputType === "pin" ? "pin" : "post"}
          postCount={topic.linkedPostId ? 1 : 0}
          pinCount={pins.length}
          rail={
            <MaterialRail
              topicId={id}
              items={topic.items}
              materials={materials}
              candidates={materialModal}
            />
          }
          postStage={
            <StageStateGate kind="post">
              {topic.linkedPostId && linkedDoc ? (
                <ArticleOutputCard postId={topic.linkedPostId.toString()} doc={linkedDoc} />
              ) : (
                <StageGuideCard
                  variant="post"
                  materialsCount={topic.items.length}
                  configured={(topic.positioning ?? "").trim() !== ""}
                />
              )}
            </StageStateGate>
          }
          pinStage={
            <StageStateGate kind="pin" pinTarget={pinParsed.selection.count}>
              {pins.length > 0 ? (
                <PinOutputsGrid pins={pins} />
              ) : (
                <StageGuideCard
                  variant="pin"
                  materialsCount={topic.items.length}
                  configured={(topic.pinPositioning ?? "").trim() !== ""}
                />
              )}
            </StageStateGate>
          }
          writingConfig={<TopicWritingConfigPanel id={id} positioning={topic.positioning} />}
          pinConfig={
            <PinConfigPanel id={id} pinPositioning={topic.pinPositioning} candidates={references} />
          }
          createBar={
            <div className="rounded-sm border border-line bg-panel p-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.25)]">
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
                outputType={topic.outputType}
                baseline={baseline}
              />
            </div>
          }
        />
      </StudioGenerationProvider>
    </div>
  );
}
