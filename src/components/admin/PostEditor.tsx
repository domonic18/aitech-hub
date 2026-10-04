"use client";

/**
 * Markdown 文章编辑器(M5-a 立骨,M5-d 换 Vditor 分屏编辑):左编辑/前台预览 + 右元信息栏。
 * 保存走 POST /api/posts(新建,slug 缺省由标题派生,冲突自动 -2…-9 后缀)/
 * PUT /api/posts/[id](更新,slug 只读);发布 = 先保存再 POST publish(全页跳转刷新)。
 * 「前台预览」Tab 复用线上渲染链 ArticleBody(react-markdown + GFM + 高亮)——
 * Vditor 内置预览与其有细微差异,发布前以此做最终核对(单一渲染链不变式)。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import PostMetaPanel, {
  type EditorCategory,
  type PostMetaValue,
  type SlugField,
} from "@/components/admin/PostMetaPanel";
import MdEditor from "@/components/admin/MdEditor";
import ArticleBody from "@/components/article/ArticleBody";
import {
  POST_LIMITS,
  postCreateSchema,
  postUpdateSchema,
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
  /** 展示态(server 端 postDisplayState 派生):published/draft/unpublished */
  status: PostDisplayState;
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
type SaveBody = ApiEnvelope<{ id?: string } | null>;

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
}: {
  categories: EditorCategory[];
  post?: EditorPost;
  /** 一键发文交接(/admin/posts/new?import=1):EditorTextarea mount 时消费 sessionStorage */
  imported?: boolean;
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
  });
  const [status, setStatus] = useState(post?.status ?? "draft");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // 派生预览(创建/编辑同规则):显式输入优先,否则标题 ASCII token;纯中文标题 → bare-id
  const slugPreview = useMemo(() => {
    const derived = asciiSlugFromTitle(slugText.trim() || title);
    return derived ? `/post/…-${derived}/` : "/post/<id>/(纯中文标题,由 id 锚定)";
  }, [slugText, title]);

  const slugField: SlugField = { text: slugText, preview: slugPreview, onChange: setSlugText };

  async function saveOnly(): Promise<string | null> {
    setBusy(true);
    setError(null);
    try {
      // 边界校验与服务端同源(评审 W2:复用 Zod schema 单轨,不另抄规则)
      const schema = mode === "create" ? postCreateSchema : postUpdateSchema;
      const parsed = schema.safeParse({
        title: title.trim(),
        categorySlug: meta.categorySlug,
        contentMd,
        tags: splitTags(meta.tagsText),
        excerpt: meta.excerpt,
        coverPath: meta.coverPath,
        seoTitle: meta.seoTitle,
        seoDescription: meta.seoDescription,
        ...(slugText.trim() ? { slug: slugText.trim() } : {}), // 缺省:创建=按标题派生/更新=不改
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "输入不合法");
        return null;
      }
      const res = await fetch(mode === "create" ? "/api/posts" : `/api/posts/${post!.id}`, {
        method: mode === "create" ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = (await res.json().catch(() => null)) as SaveBody | null;
      if (!res.ok || json?.code !== 0) {
        setError(json?.message ?? `保存失败(${res.status})`);
        return null;
      }
      return json.data?.id ?? post!.id;
    } catch {
      setError("网络错误,请重试");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(): Promise<void> {
    const id = await saveOnly();
    if (!id) return;
    if (mode === "create") {
      router.replace(`/admin/posts/${id}`); // 草稿落库后地址切为编辑态(后续保存走 PUT)
    } else {
      setSavedAt(new Date());
    }
  }

  async function publish(): Promise<void> {
    const id = await saveOnly();
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${id}/publish`, { method: "POST" });
      if (res.ok) {
        window.location.href = `/admin/posts/${id}`; // 全页跳转:编辑器头部状态整体刷新
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
      {savedAt && !error && (
        <div className="text-xs text-text-3">已保存 {formatCnTime(savedAt)}</div>
      )}

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="文章标题…"
        maxLength={POST_LIMITS.title}
        className={INPUT}
      />

      <div className="grid grid-cols-[1fr_300px] items-start gap-4">
        <div className="rounded-md border border-line bg-panel">
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

        <PostMetaPanel
          categories={categories}
          value={meta}
          tagCount={splitTags(meta.tagsText).length}
          onChange={(patch) => setMeta((m) => ({ ...m, ...patch }))}
          slug={slugField}
        />
      </div>
    </div>
  );
}
