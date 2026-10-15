"use client";

/**
 * Markdown 文章编辑器(M5-a 立骨,M5-d 换 Vditor 分屏编辑):左编辑/前台预览 + 右元信息栏。
 * 右栏可整体收起(M16,localStorage 持久化)便于沉浸编辑;左卡与右栏同网格行
 * stretch 对齐(SEO 选项展开时编辑器同步长高,不留空白)。
 * 保存走 POST /api/posts(新建,slug 缺省由标题派生,冲突自动 -2…-9 后缀)/
 * PUT /api/posts/[id](更新,slug 只读);发布 = 先保存再 POST publish(全页跳转刷新)。
 * 「前台预览」Tab 复用线上渲染链 ArticleBody(react-markdown + GFM + 高亮)——
 * Vditor 内置预览与其有细微差异,发布前以此做最终核对(单一渲染链不变式)。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import PostMetaPanel, {
  type EditorCategory,
  type PostMetaValue,
  type SlugField,
} from "@/components/admin/PostMetaPanel";
import MdEditor from "@/components/admin/MdEditor";
import ArticleBody from "@/components/article/ArticleBody";
import EditorAssistant, { type AssistantLaunch } from "@/components/admin/EditorAssistant";
import {
  clearPostShadow,
  readPostShadow,
  type AutosaveResult,
  type PostShadow,
} from "@/components/admin/usePostAutosave";
import usePostAutosave from "@/components/admin/usePostAutosave";
import EditorWechatSyncButton from "@/components/admin/distribute/EditorWechatSyncButton";
import {
  POST_LIMITS,
  postCreateSchema,
  postUpdateSchema,
  type ContentOrigin,
  type PostDisplayState,
} from "@/lib/content/post-schema";
import { type ApiEnvelope } from "@/lib/http/response";
import { asciiSlugFromTitle } from "@/lib/content/post-path";
import { formatCnTime } from "@/lib/datetime";

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

/** 服务端包络(形态引用 ApiEnvelope,评审 W3:客户端不手写同形接口) */
type SaveBody = ApiEnvelope<{ id?: string; updatedAt?: string; reason?: string } | null>;

/** 标签输入按分隔符切分去重(与 service 的 slug 去重双保险) */
function splitTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of text.split(/[,，、\s]+/).map((s) => s.trim())) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

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
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  const [seoBusy, setSeoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // 乐观锁基准(M27 批①):随每次成功保存以服务端 updatedAt 推进
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(post?.updatedAt ?? null);
  // 乐观锁冲突:停自动存,人工刷新决策(人话横幅,不强覆盖)
  const [conflict, setConflict] = useState(false);
  // 影子副本恢复提示(崩溃/断网后挂载时检测,方案 §5)
  const [shadowOffer, setShadowOffer] = useState<PostShadow | null>(null);
  // 右栏收起(沉浸编辑,M16):mount 后读 localStorage 防 hydration 分歧;收起=右栏不渲染
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 封面 agent 唤起(M31 验收反馈):弹窗「生成候选」→ 开侧边栏助手直发生成指令
  const [assistantLaunch, setAssistantLaunch] = useState<AssistantLaunch | null>(null);
  const launchCoverAgent = useCallback((): void => {
    setAssistantLaunch({
      question:
        "为本文生成封面候选。请先用 ask_user 给我 2-4 个提示词方向(风格/主体/配色)选择," +
        "再按选定方向生成 2 张候选,等我确认入库。",
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

  /**
   * 保存唯一通道(手动钮/发布/自动保存共用)。三态结果供自动保存调度;
   * autosave=true 时失败不上全局横幅(状态行轻提示),冲突仍上横幅须人工介入。
   */
  async function saveOnly(autosave = false): Promise<AutosaveResult> {
    if (!autosave) {
      setBusy(true);
      setError(null);
    }
    try {
      // 边界校验与服务端同源(评审 W2:复用 Zod schema 单轨,不另抄规则)
      const schema = mode === "create" ? postCreateSchema : postUpdateSchema;
      const sentJson = buildPayloadJson();
      const input = JSON.parse(sentJson) as Record<string, unknown>;
      if (mode === "edit" && expectedUpdatedAt) input.expectedUpdatedAt = expectedUpdatedAt;
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? "输入不合法";
        if (!autosave) setError(message);
        return { status: "failed" };
      }
      const res = await fetch(mode === "create" ? "/api/posts" : `/api/posts/${post!.id}`, {
        method: mode === "create" ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = (await res.json().catch(() => null)) as SaveBody | null;
      if (!res.ok || json?.code !== 0) {
        const stale = json?.data?.reason === "stale_update";
        if (stale) {
          setConflict(true); // 停自动存;横幅须人工刷新决策,不强覆盖
          setError(`${json?.message ?? "文章已在其他端被修改"}(自动保存已暂停)`);
          return { status: "conflict" };
        }
        if (!autosave) setError(json?.message ?? `保存失败(${res.status})`);
        return { status: "failed" };
      }
      const id = json.data?.id ?? post!.id;
      if (mode === "edit" && json.data?.updatedAt) {
        setExpectedUpdatedAt(json.data.updatedAt); // 写读闭环:下一拍以此为乐观锁基准
        setSavedAt(new Date());
        clearPostShadow(post!.id);
      }
      return { status: "saved", id, payloadJson: sentJson, updatedAt: json.data?.updatedAt ?? "" };
    } catch {
      if (!autosave) setError("网络错误,请重试");
      return { status: "failed" };
    } finally {
      if (!autosave) setBusy(false);
    }
  }

  /** SEO 一键补全(2026-10-06 验收反馈问题7):同步轻调用,正文取样前 4000 字;
   * 生成值直接覆盖两个 SEO 字段(重按即重新生成),不影响其他表单态。 */
  async function seoSuggest(): Promise<void> {
    if (title.trim() === "" && contentMd.trim() === "") {
      setError("请先填写标题或正文,再点 AI 填充");
      return;
    }
    setSeoBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/posts/seo-suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          contentMd: contentMd.slice(0, 4000),
          excerpt: meta.excerpt,
          tags: splitTags(meta.tagsText),
          categorySlug: meta.categorySlug,
        }),
      });
      const json = (await res.json().catch(() => null)) as ApiEnvelope<{
        seoTitle: string;
        seoDescription: string;
      }> | null;
      if (!res.ok || json?.code !== 0 || !json.data) {
        setError(json?.message ?? `生成失败(${res.status})`);
        return;
      }
      setMeta((m) => ({
        ...m,
        seoTitle: json.data!.seoTitle,
        seoDescription: json.data!.seoDescription,
      }));
    } catch {
      setError("网络错误,请重试");
    } finally {
      setSeoBusy(false);
    }
  }

  async function saveDraft(): Promise<void> {
    const result = await saveOnly();
    if (result.status !== "saved") return;
    if (mode === "create") {
      router.replace(`/admin/posts/${result.id}`); // 草稿落库后地址切为编辑态(后续保存走 PUT)
    } else {
      setSavedAt(new Date());
    }
  }

  async function publish(): Promise<void> {
    const result = await saveOnly();
    if (result.status !== "saved") return;
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${result.id}/publish`, { method: "POST" });
      if (res.ok) {
        window.location.href = `/admin/posts/${result.id}`; // 全页跳转:编辑器头部状态整体刷新
        return;
      }
      const json = (await res.json().catch(() => null)) as SaveBody | null;
      setError(json?.message ?? `发布失败(${res.status})`);
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  async function unpublish(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post!.id}/unpublish`, { method: "POST" });
      if (res.ok) {
        setStatus("draft");
        router.refresh();
        return;
      }
      const json = (await res.json().catch(() => null)) as SaveBody | null;
      setError(json?.message ?? `下架失败(${res.status})`);
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  /** 自动保存状态行(仅编辑态草稿启用自动存;其余形态保持手动「已保存」行) */
  const autosaveLine = ((): string | null => {
    if (mode !== "edit" || status !== "draft") {
      return savedAt ? `已保存 ${formatCnTime(savedAt)}` : null;
    }
    switch (autosavePhase) {
      case "saving":
        return "自动保存中…";
      case "saved":
        return savedAt ? `已自动保存 ${formatCnTime(savedAt)}` : "已自动保存";
      case "dirty":
        return "有未保存修改(将自动保存)";
      case "failed":
        return "自动保存失败,已留本地底稿(继续编辑将重试)";
      case "conflict":
        return "自动保存已暂停";
      default:
        return savedAt ? `已保存 ${formatCnTime(savedAt)}` : null;
    }
  })();

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

      {error && (
        <div className="rounded-sm border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
          {error}
        </div>
      )}
      {autosaveLine && !error && <div className="text-xs text-text-3">{autosaveLine}</div>}
      {/* 影子副本恢复提示(M27 批①方案 §5):崩溃/断网留底的本地修改 */}
      {shadowOffer && (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-amber-hi">
          <span>
            检测到未保存的本地修改(留底于 {formatCnTime(new Date(shadowOffer.at))}
            ),是否恢复正文与标题?
          </span>
          <button
            type="button"
            className="cursor-pointer font-semibold underline"
            onClick={() => {
              setTitle(shadowOffer.title);
              setContentMd(shadowOffer.contentMd);
              setShadowOffer(null); // 影子保留至保存成功,期间崩溃可再次恢复
            }}
          >
            恢复
          </button>
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={() => {
              if (post) clearPostShadow(post.id);
              setShadowOffer(null);
            }}
          >
            丢弃
          </button>
        </div>
      )}

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
        <div className="flex flex-col rounded-md border border-line bg-panel">
          <div className="flex border-b border-line text-xs">
            {(["edit", "preview"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`cursor-pointer border-r border-line px-4 py-2 ${
                  tab === t
                    ? "bg-accent-dim font-semibold text-accent"
                    : "text-text-2 hover:bg-panel-2"
                }`}
              >
                {t === "edit" ? "编辑(分屏)" : "前台预览"}
              </button>
            ))}
          </div>

          {tab === "edit" ? (
            <MdEditor value={contentMd} onChange={setContentMd} imported={imported ?? false} />
          ) : (
            <div className="min-h-[520px] max-h-[720px] overflow-y-auto p-4">
              <ArticleBody contentMd={contentMd} contentHtml={null} />
            </div>
          )}
        </div>

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
