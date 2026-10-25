"use client";

/**
 * 文章自动保存(M27 批①,方案 §5):debounce 2.5s → PUT(仅编辑态草稿文,
 * published 保持手动口径)。updatedAt 乐观锁:保存成功以响应 updatedAt 推进
 * 基准,冲突(stale_update 409)即停自动存并回调人话提示——不强覆盖。
 * localStorage 影子副本(postId 键):脏期 debounce 落底 + beforeunload 兜底,
 * 保存成功即清;崩溃/断网后由编辑器挂载时 readPostShadow 提供恢复提示。
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type AutosavePhase = "idle" | "dirty" | "saving" | "saved" | "failed" | "conflict";

const AUTOSAVE_DEBOUNCE_MS = 2500;

const shadowKey = (postId: string): string => `ah:editor:shadow:${postId}`;

export interface PostShadow {
  title: string;
  contentMd: string;
  /** 影子落底时刻 ISO(恢复提示据此与库内 updatedAt 比新旧) */
  at: string;
}

export function readPostShadow(postId: string): PostShadow | null {
  try {
    const raw = window.localStorage.getItem(shadowKey(postId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PostShadow>;
    if (typeof parsed.contentMd !== "string" || typeof parsed.at !== "string") return null;
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      contentMd: parsed.contentMd,
      at: parsed.at,
    };
  } catch {
    return null; // 隐私模式/损坏 JSON:无影子不阻塞编辑
  }
}

function writePostShadow(postId: string, shadow: PostShadow): void {
  try {
    window.localStorage.setItem(shadowKey(postId), JSON.stringify(shadow));
  } catch {
    // 落底失败不阻塞保存主链
  }
}

export function clearPostShadow(postId: string): void {
  try {
    window.localStorage.removeItem(shadowKey(postId));
  } catch {
    // 同上
  }
}

export interface AutosaveEvent {
  type: "saved";
  /** saved:服务端回传的新基准(下一拍 expectedUpdatedAt) */
  updatedAt: string;
}

/** save 执行结果:PostEditor 的 saveOnly 三态映射(网络/校验失败/乐观锁冲突) */
export type AutosaveResult =
  | {
      status: "saved";
      /** 新建态取此 id 切编辑地址/发发布请求 */ id: string;
      payloadJson: string;
      updatedAt: string;
    }
  | { status: "failed" }
  | { status: "conflict" };

interface UsePostAutosaveOptions {
  /** 仅编辑态草稿文开自动存(published/unpublished 与创建态保持手动口径) */
  enabled: boolean;
  postId: string;
  /** 当前表单序列化(脏检测与保存基线比对,PostEditor useMemo 保持引用稳定) */
  payloadJson: string;
  /** 影子落底内容(标题+正文;元信息不入影,v1 口径) */
  shadowContent: { title: string; contentMd: string };
  /** 执行一次保存(失败/冲突的提示由实现侧自行上报;成功回传新基准) */
  save: () => Promise<AutosaveResult>;
  /** 保存成功回调(推进乐观锁基准/角标) */
  onSaved?: (e: AutosaveEvent) => void;
}

export default function usePostAutosave({
  enabled,
  postId,
  payloadJson,
  shadowContent,
  save,
  onSaved,
}: UsePostAutosaveOptions): AutosavePhase {
  const [phase, setPhase] = useState<AutosavePhase>("idle");
  // 基线 = 最近一次成功保存的 payload;初值在首个 enabled 渲染锚定(净载入不算脏)
  const baselineRef = useRef<string | null>(null);
  const anchoredRef = useRef(false);
  const payloadRef = useRef(payloadJson);
  payloadRef.current = payloadJson;
  const shadowRef = useRef(shadowContent);
  shadowRef.current = shadowContent;
  const saveRef = useRef(save);
  saveRef.current = save;
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;

  const persistShadow = useCallback((): void => {
    writePostShadow(postId, { ...shadowRef.current, at: new Date().toISOString() });
  }, [postId]);

  useEffect(() => {
    if (!enabled) {
      setPhase("idle");
      return;
    }
    if (!anchoredRef.current) {
      baselineRef.current = payloadJson;
      anchoredRef.current = true;
      return;
    }
    if (payloadJson === baselineRef.current) {
      setPhase((p) => (p === "saving" ? p : "idle"));
      return;
    }
    setPhase("dirty");
    const timer = window.setTimeout(() => {
      persistShadow(); // 落底先行:保存失败/断网时留恢复依据
      setPhase("saving");
      void saveRef.current().then((r) => {
        if (r.status === "saved") {
          baselineRef.current = r.payloadJson;
          clearPostShadow(postId);
          setPhase("saved");
          savedRef.current?.({ type: "saved", updatedAt: r.updatedAt });
          return;
        }
        // 冲突:停自动存(PostEditor 会置 enabled=false),人工刷新决策
        setPhase(r.status === "conflict" ? "conflict" : "failed");
      });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, payloadJson, postId, persistShadow]);

  // beforeunload 兜底:脏态关页来不及 debounce,同步落一次影子
  useEffect(() => {
    if (!enabled) return;
    const onUnload = (): void => {
      if (payloadRef.current !== baselineRef.current) persistShadow();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [enabled, postId, persistShadow]);

  return phase;
}
