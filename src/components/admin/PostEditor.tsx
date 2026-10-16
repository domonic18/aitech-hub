"use client";

/**
 * Markdown 文章编辑器(M5-a 立骨,M5-d 换 Vditor 分屏编辑):左编辑/前台预览 + 右元信息栏。
 * 右栏可整体收起(M16,localStorage 持久化)便于沉浸编辑;左卡与右栏同网格行
 * stretch 对齐(SEO 选项展开时编辑器同步长高,不留空白)。
 * 保存链(保存通道/发布/下架/SEO 补全/乐观锁冲突)收口在 usePostEditorSave,
 * 横幅组(EditorBanners)与正文双 Tab 卡(EditorBodyCard)已拆子件(技术债
 * 批③),本件留表单态、影子副本与编排。保存走 POST /api/posts(新建,slug
 * 缺省由标题派生,冲突自动 -2…-9 后缀)/ PUT /api/posts/[id](更新,slug
 * 只读);发布 = 先保存再 POST publish(全页跳转刷新)。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { COVER_ADOPTED_EVENT } from "@/lib/agent/cover-tool";

import PostMetaPanel, {
  type EditorCategory,
  type PostMetaValue,
  type SlugField,
} from "@/components/admin/PostMetaPanel";
import EditorBanners from "@/components/admin/EditorBanners";
import EditorBodyCard from "@/components/admin/EditorBodyCard";
import EditorAssistant, { type AssistantLaunch } from "@/components/admin/EditorAssistant";
import { readPostShadow, type PostShadow } from "@/components/admin/usePostAutosave";
import usePostAutosave from "@/components/admin/usePostAutosave";
import {
  autosaveStatusLine,
  splitTags,
  usePostEditorSave,
} from "@/components/admin/usePostEditorSave";
import EditorWechatSyncButton from "@/components/admin/distribute/EditorWechatSyncButton";
import { POST_LIMITS, type ContentOrigin, type PostDisplayState } from "@/lib/content/post-schema";
import { asciiSlugFromTitle } from "@/lib/content/post-path";

import { INPUT } from "./editor-controls";

export type { EditorCategory };

export interface EditorPost {
  id: string;
  title: string;
  slug: string | null;
  categorySlug: string;
  tags: string[];
  contentMd: string;
  excerpt: string;
  coverPath: string;
  seoTitle: string;
  seoDescription: string;
  /** 创作方式(合规标识):human/ai_assisted/ai_generated,缺省人工 */
  contentOrigin: ContentOrigin;
  /** 阅读门禁(M21 批⑤ + 补齐批):付费 price 为 number(无付费 null);登录可见与付费互斥 */
  isPurchasable: boolean;
  purchasePrice: number | null;
  isLoginRequired: boolean;
  /** 展示态(server 端 postDisplayState 派生):published/draft/unpublished */
  status: PostDisplayState;
  /** 乐观锁基准(M27 批①):加载时刻 updatedAt ISO,自动保存链随写更新 */
  updatedAt: string;
}

const STATUS_LABEL: Record<PostDisplayState, string> = {
  published: "已发布",
  draft: "草稿",
  unpublished: "已下架",
};

const BTN_SECONDARY =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-panel px-3 py-2 text-sm text-text-1 hover:border-line-hover disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";

export default function PostEditor({
  categories,
  post,
  imported,
  wechat,
}: {
  categories: EditorCategory[];
  post?: EditorPost;
  /** 一键发文交接(/admin/posts/new?import=1):EditorTextarea mount 时消费 sessionStorage */
  imported?: boolean;
  /** 公众号同步入口(M31):ready=渠道配置就绪;status=该稿微信渠道行状态 */
  wechat?: { ready: boolean; status: string | null };
}): React.ReactElement {
  const router = useRouter();
  const mode = post ? ("edit" as const) : ("create" as const);

  const [title, setTitle] = useState(post?.title ?? "");
  const [slugText, setSlugText] = useState(post?.slug ?? "");
  const [contentMd, setContentMd] = useState(post?.contentMd ?? "");
  const [meta, setMeta] = useState<PostMetaValue>({
    categorySlug: post?.categorySlug ?? categories[0]?.slug ?? "",
    tagsText: post?.tags.join("、") ?? "",
    coverPath: post?.coverPath ?? "",
    excerpt: post?.excerpt ?? "",
    seoTitle: post?.seoTitle ?? "",
    seoDescription: post?.seoDescription ?? "",
    contentOrigin: post?.contentOrigin ?? "human",
    isPurchasable: post?.isPurchasable ?? false,
    purchasePriceText: post?.purchasePrice != null ? post.purchasePrice.toFixed(2) : "",
    isLoginRequired: post?.isLoginRequired ?? false,
  });
  const [status, setStatus] = useState(post?.status ?? "draft");
  // 影子副本恢复提示(崩溃/断网后挂载时检测,方案 §5)
  const [shadowOffer, setShadowOffer] = useState<PostShadow | null>(null);
  // 右栏收起(沉浸编辑,M16):mount 后读 localStorage 防 hydration 分歧;收起=右栏不渲染
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 封面 agent 唤起(M31 验收反馈):弹窗「生成候选」→ 开侧边栏助手直发生成指令
  const [assistantLaunch, setAssistantLaunch] = useState<AssistantLaunch | null>(null);
  const launchCoverAgent = useCallback((): void => {
    setAssistantLaunch({
      question:
        "为本文生成封面候选。请先读文章内容,推理 2-4 个差异化的封面方向(风格/主体/配色/" +
        "拟融入画面的主题文字),用 ask_user 让我选择;我选定后把该方向写成完整生图提示词" +
        "(要求画面融入文章主题的简短中文文字),用 ask_user 的 detail 字段附提示词全文让我确认;" +
        "确认后再生成 2 张候选,等我挑一张入库。",
      nonce: Date.now(),
    });
  }, []);
  useEffect(() => {
    try {
      setSidebarCollapsed(localStorage.getItem("ah:editor:sidebar-collapsed") === "1");
    } catch {
      // 隐私模式等 localStorage 不可用:保持默认展开
    }
  }, []);

  function toggleSidebar(): void {
    setSidebarCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("ah:editor:sidebar-collapsed", next ? "1" : "0");
      } catch {
        // 持久化失败不影响本次切换
      }
      return next;
    });
  }

  // Agent 评审面接线(M27 批⑧-d):getter 走 ref 快照(评审挂载瞬间读,引用
  // 稳定不触发子树重渲染);应用 = 整段 setContentMd(与影子恢复同路径,
  // Vditor 受控 setValue → dirty → 自动保存落库;undo 口径批⑨ 真机验证)
  const contentMdRef = useRef(contentMd);
  contentMdRef.current = contentMd;
  const getAssistantContent = useCallback(() => contentMdRef.current, []);
  const applyAssistantContent = useCallback((md: string) => setContentMd(md), []);

  // 派生预览(创建/编辑同规则):显式输入优先,否则标题 ASCII token;纯中文标题 → bare-id
  const slugPreview = useMemo(() => {
    const derived = asciiSlugFromTitle(slugText.trim() || title);
    return derived ? `/post/…-${derived}/` : "/post/<id>/(纯中文标题,由 id 锚定)";
  }, [slugText, title]);

  const slugField: SlugField = { text: slugText, preview: slugPreview, onChange: setSlugText };

  /** 表单快照序列化:脏检测(useMemo)与保存基线共用同一构造,保证可比 */
  function buildPayloadJson(): string {
    return JSON.stringify({
      title: title.trim(),
      categorySlug: meta.categorySlug,
      contentMd,
      tags: splitTags(meta.tagsText),
      excerpt: meta.excerpt,
      coverPath: meta.coverPath,
      seoTitle: meta.seoTitle,
      seoDescription: meta.seoDescription,
      contentOrigin: meta.contentOrigin,
      isPurchasable: meta.isPurchasable,
      purchasePrice: meta.isPurchasable ? Number.parseFloat(meta.purchasePriceText) : null,
      isLoginRequired: meta.isLoginRequired,
      slug: slugText.trim() || undefined,
    });
  }

  // 字符串按值比较:hook effect 仅在快照真变时重排(debounce 重置),无需 useMemo
  const payloadJson = buildPayloadJson();

  // 保存链(手动/发布/下架/SEO 补全/乐观锁冲突;技术债批③收口)
  const {
    busy,
    seoBusy,
    error,
    savedAt,
    conflict,
    saveOnly,
    saveDraft,
    publish,
    unpublish,
    seoSuggest,
    syncExpectedUpdatedAt,
  } = usePostEditorSave({
    mode,
    postId: post?.id,
    title,
    contentMd,
    meta,
    setMeta,
    buildPayloadJson,
    onCreateSaved: (id) => router.replace(`/admin/posts/${id}`),
    onUnpublished: () => {
      setStatus("draft");
      router.refresh();
    },
  });

  // 封面 agent 入库回写(2026-10-16 反馈问题一):adopt+设封面在 agent 会话内
  // 完成,编辑器状态感知不到。候选卡在 resume run 结束后广播事件,这里刷新
  // 服务端 props(库内新封面 + 新 updatedAt),下方两个 effect 只同步这两项。
  const postId = post?.id;
  useEffect(() => {
    if (mode !== "edit" || !postId) return;
    const onCoverAdopted = (e: Event): void => {
      const detail = (e as CustomEvent<{ postId?: string }>).detail;
      if (detail?.postId && detail.postId !== postId) return;
      router.refresh();
    };
    window.addEventListener(COVER_ADOPTED_EVENT, onCoverAdopted);
    return () => window.removeEventListener(COVER_ADOPTED_EVENT, onCoverAdopted);
  }, [mode, postId, router]);

  // refresh 后的定向同步:只跟随封面显示与乐观锁基线,不碰正文/标题等本地
  // 编辑态(防覆盖未保存输入);基线仅在已有锁时跟随(usePostEditorSave 内收口)
  useEffect(() => {
    if (!post?.updatedAt) return;
    syncExpectedUpdatedAt(post.updatedAt);
  }, [post?.updatedAt, syncExpectedUpdatedAt]);
  useEffect(() => {
    const server = post?.coverPath ?? "";
    setMeta((m) => (m.coverPath === server ? m : { ...m, coverPath: server }));
  }, [post?.coverPath]);

  // 自动保存(仅编辑态草稿;冲突后 enabled 翻 false 停调度,方案 §5)
  const autosavePhase = usePostAutosave({
    enabled: mode === "edit" && status === "draft" && !conflict,
    postId: post?.id ?? "",
    payloadJson,
    shadowContent: { title, contentMd },
    save: () => saveOnly(true),
  });

  // 影子副本恢复检测:挂载时影子比库内新且内容有差 → 提示恢复(崩溃/断网兜底)
  useEffect(() => {
    if (mode !== "edit" || !post) return;
    const shadow = readPostShadow(post.id);
    if (shadow && shadow.at > post.updatedAt && shadow.contentMd !== post.contentMd) {
      setShadowOffer(shadow);
    }
  }, [mode, post]);

  const autosaveLine = autosaveStatusLine(mode, status, autosavePhase, savedAt);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/posts" className="text-xs text-text-2 hover:text-accent">
          ← 返回列表
        </Link>
        <span className="rounded-sm bg-panel-2 px-2 py-0.5 font-mono text-[11px] text-text-3">
          {STATUS_LABEL[status]}
          {mode === "create" ? "(新)" : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {mode === "edit" && post && (
            <EditorAssistant
              postId={post.id}
              title={title}
              getContent={getAssistantContent}
              onApplyContent={applyAssistantContent}
              launch={assistantLaunch}
            />
          )}
          <button
            type="button"
            aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
            title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
            className="inline-flex cursor-pointer items-center rounded-sm border border-line bg-panel px-2 py-2 text-text-2 hover:border-line-hover hover:text-text-1"
            onClick={toggleSidebar}
          >
            <svg className="ic" aria-hidden="true">
              <use href="#i-menu" />
            </svg>
          </button>
          {wechat && post && (
            <EditorWechatSyncButton
              wechatReady={wechat.ready}
              post={{
                id: post.id,
                title,
                seoTitle: meta.seoTitle,
                excerpt: meta.excerpt,
                seoDescription: meta.seoDescription,
                coverPath: meta.coverPath,
                wechatStatus: wechat.status,
              }}
            />
          )}
          {status === "published" && (
            <button type="button" disabled={busy} className={BTN_SECONDARY} onClick={unpublish}>
              下架
            </button>
          )}
          <button type="button" disabled={busy} className={BTN_SECONDARY} onClick={saveDraft}>
            <svg className="ic" aria-hidden="true">
              <use href="#i-check" />
            </svg>
            {busy ? "处理中…" : "存草稿"}
          </button>
          <button type="button" disabled={busy} className={BTN_PRIMARY} onClick={publish}>
            <svg className="ic" aria-hidden="true">
              <use href="#i-cloudupload" />
            </svg>
            {status === "unpublished" ? "重新上架" : "发布"}
          </button>
        </div>
      </div>

      <EditorBanners
        error={error}
        autosaveLine={autosaveLine}
        shadowOffer={shadowOffer}
        postId={post?.id}
        onShadowRecover={(s) => {
          setTitle(s.title);
          setContentMd(s.contentMd);
          setShadowOffer(null); // 影子保留至保存成功,期间崩溃可再次恢复
        }}
        onShadowDismiss={() => setShadowOffer(null)}
      />

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="文章标题…"
        maxLength={POST_LIMITS.title}
        className={INPUT}
      />

      {/* 默认 stretch(勿加 items-start):右栏 SEO 展开变高时左编辑器卡片同步长高(M16) */}
      <div
        className={`grid grid-cols-1 gap-4 ${sidebarCollapsed ? "" : "lg:grid-cols-[1fr_300px]"}`}
      >
        <EditorBodyCard value={contentMd} onChange={setContentMd} imported={imported ?? false} />

        {!sidebarCollapsed && (
          <PostMetaPanel
            categories={categories}
            value={meta}
            tagCount={splitTags(meta.tagsText).length}
            onChange={(patch) => setMeta((m) => ({ ...m, ...patch }))}
            slug={slugField}
            onSeoSuggest={() => void seoSuggest()}
            seoSuggesting={seoBusy}
            coverContext={{
              postId: post?.id,
              title,
              excerpt: meta.excerpt,
              tags: splitTags(meta.tagsText),
              contentMd: contentMd.slice(0, 4000),
            }}
            onAgentCoverGen={launchCoverAgent}
          />
        )}
      </div>
    </div>
  );
}
