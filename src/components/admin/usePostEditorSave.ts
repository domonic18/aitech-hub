"use client";

/**
 * 编辑器保存链收口(技术债批③,自 PostEditor 抽出):saveOnly 唯一保存通道
 * (手动钮/发布/自动保存共用;Zod 边界与服务端同源单轨,乐观锁冲突收敛为
 * 人工决策横幅)+ 存草稿/发布/下架/SEO 一键补全,与 busy/error/savedAt/
 * conflict 状态。自动保存状态行文案由纯函数 autosaveStatusLine 派生(可单测)。
 */
import { useCallback, useState } from "react";

import {
  postCreateSchema,
  postUpdateSchema,
  type PostDisplayState,
} from "@/lib/content/post-schema";
import { type ApiEnvelope } from "@/lib/http/response";
import { formatCnTime } from "@/lib/datetime";
import type { PostMetaValue } from "@/components/admin/PostMetaPanel";
import {
  clearPostShadow,
  type AutosavePhase,
  type AutosaveResult,
} from "@/components/admin/usePostAutosave";

/** 服务端包络(形态引用 ApiEnvelope,评审 W3:客户端不手写同形接口) */
type SaveBody = ApiEnvelope<{ id?: string; updatedAt?: string; reason?: string } | null>;

/** 标签输入按分隔符切分去重(与 service 的 slug 去重双保险;保存与 SEO 补全共用) */
export function splitTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of text.split(/[,，、\s]+/).map((s) => s.trim())) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** 自动保存状态行(仅编辑态草稿启用自动存;其余形态保持手动「已保存」行) */
export function autosaveStatusLine(
  mode: "create" | "edit",
  status: PostDisplayState,
  autosavePhase: AutosavePhase,
  savedAt: Date | null,
): string | null {
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
}

interface UsePostEditorSaveDeps {
  mode: "create" | "edit";
  /** 编辑态文章 id;创建态 undefined */
  postId?: string;
  title: string;
  contentMd: string;
  meta: PostMetaValue;
  setMeta: (updater: (m: PostMetaValue) => PostMetaValue) => void;
  /** 表单快照(脏检测与保存基线同一构造,editor 持有) */
  buildPayloadJson: () => string;
  /** 创建态草稿落库后切编辑态地址(editor 侧 router.replace) */
  onCreateSaved: (id: string) => void;
  /** 下架成功(editor 侧 setStatus + router.refresh) */
  onUnpublished: () => void;
}

export function usePostEditorSave(deps: UsePostEditorSaveDeps): {
  busy: boolean;
  seoBusy: boolean;
  error: string | null;
  setError: (v: string | null) => void;
  savedAt: Date | null;
  conflict: boolean;
  saveOnly: (autosave?: boolean) => Promise<AutosaveResult>;
  saveDraft: () => Promise<void>;
  publish: () => Promise<void>;
  unpublish: () => Promise<void>;
  seoSuggest: () => Promise<void>;
  /** 乐观锁基线跟随服务端旁路写(editor 经 router.refresh 后对齐,防误报 409) */
  syncExpectedUpdatedAt: (iso: string) => void;
} {
  const [busy, setBusy] = useState(false);
  const [seoBusy, setSeoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // 乐观锁基准(M27 批①):随每次成功保存以服务端 updatedAt 推进
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  // 乐观锁冲突:停自动存,人工刷新决策(人话横幅,不强覆盖)
  const [conflict, setConflict] = useState(false);
  const { mode, postId, title, contentMd, meta, setMeta, buildPayloadJson } = deps;

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
      const res = await fetch(mode === "create" ? "/api/posts" : `/api/posts/${postId}`, {
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
      const id = json.data?.id ?? postId;
      if (mode === "edit" && json.data?.updatedAt) {
        setExpectedUpdatedAt(json.data.updatedAt); // 写读闭环:下一拍以此为乐观锁基准
        setSavedAt(new Date());
        clearPostShadow(postId!);
      }
      return {
        status: "saved",
        id: id!,
        payloadJson: sentJson,
        updatedAt: json.data?.updatedAt ?? "",
      };
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
      deps.onCreateSaved(result.id); // 草稿落库后地址切为编辑态(后续保存走 PUT)
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
      const res = await fetch(`/api/posts/${postId}/unpublish`, { method: "POST" });
      if (res.ok) {
        deps.onUnpublished();
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

  /** 乐观锁基线跟随服务端旁路写(2026-10-16 反馈问题一):封面 agent 入库等
   * 带 router.refresh() 的写会推进库内 updatedAt,编辑器据此对齐基线防误报
   * 409。仅在已有基线时跟随——从未保存过的稿子保持「首存无锁」语义不变。 */
  const syncExpectedUpdatedAt = useCallback((iso: string): void => {
    setExpectedUpdatedAt((prev) => (prev === null ? prev : iso));
  }, []);

  return {
    busy,
    seoBusy,
    error,
    setError,
    savedAt,
    conflict,
    saveOnly,
    saveDraft,
    publish,
    unpublish,
    seoSuggest,
    syncExpectedUpdatedAt,
  };
}
