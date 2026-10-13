"use client";

/**
 * 专题合成操作区(M26 批④,方案 §8 详情三区之三):合成初稿/重合成(同步调用,
 * 约十几秒)+ 重合成保护 409 needConfirm 的 confirm 二次确认 + 跳转文档衔接
 * (编辑器人工定稿)。未绑 compose 模型 400 人话行内展示。
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";

interface ComposeResponse {
  code: number;
  message: string;
  data?: {
    postId?: string;
    recomposed?: boolean;
    needConfirm?: boolean;
    coverPath?: string | null;
  };
}

export default function TopicComposeActions({
  topicId,
  linkedPostId,
  linkedPostStatus,
  editedSinceCompose,
}: {
  topicId: string;
  linkedPostId: string | null;
  /** 关联文档状态(重合成提示口径:published 覆盖即上线内容变更) */
  linkedPostStatus: string | null;
  /** 服务端预判:合成后被人工编辑过(按钮 title 提示,实际判定以 409 为准) */
  editedSinceCompose: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [postId, setPostId] = useState<string | null>(linkedPostId);

  async function call(confirm: boolean): Promise<ComposeResponse & { ok: boolean }> {
    const res = await fetch(`/api/topics/${topicId}/compose/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(confirm ? { confirm: true } : {}),
    });
    const body = (await res.json()) as ComposeResponse;
    return { ...body, ok: res.ok && body.code === 0 };
  }

  async function compose(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      let r = await call(false);
      if (r.code === 409 && r.data?.needConfirm) {
        if (!window.confirm(r.message)) {
          setMsg({ tone: "err", text: "已取消重合成(人工改动保留)" });
          return;
        }
        r = await call(true);
      }
      if (!r.ok) {
        setMsg({ tone: "err", text: r.message || `合成失败(${r.code})` });
        return;
      }
      if (r.data?.postId) setPostId(r.data.postId);
      // 批②:封面转存成功才提示(null=无视频素材或转存降级,可后补不阻塞)
      const coverHint = r.data?.coverPath ? ";视频封面已转存为文章头图" : "";
      setMsg({ tone: "ok", text: r.message + coverHint });
      router.refresh();
    } catch {
      setMsg({ tone: "err", text: "网络异常,请重试" });
    } finally {
      setBusy(false);
    }
  }

  const hasDoc = postId !== null;

  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void compose()}
          disabled={busy}
          className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
          title={
            editedSinceCompose
              ? linkedPostStatus === "published"
                ? "关联文档已发布且被编辑过,重合成将覆盖线上内容"
                : "关联文档在合成后被人工编辑过,重合成将二次确认"
              : undefined
          }
        >
          {busy ? "合成中…(约十几秒)" : hasDoc ? "重合成(覆盖文档)" : "合成初稿"}
        </button>
        {hasDoc && (
          <Link
            href={`/admin/posts/${postId}`}
            className="rounded-sm border border-line px-2.5 py-1 text-xs text-text-2 hover:border-accent hover:text-text-1"
          >
            跳转文档(人工定稿)
          </Link>
        )}
        <span className="text-[11px] text-text-3">
          需在 AI 配置绑定「专题合成」模型;笔记缺失素材自动降级用短结论
        </span>
      </div>
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
