"use client";

/**
 * 公众号同步弹窗(M17 批④):标题(≤64)/摘要(≤120)/封面 三项按渠道微调,
 * 默认预填文章当前值(SEO 标题/摘要/封面),封面可从媒体库换选(MediaPicker 复用)。
 * 提交 → 202 {jobId,token} → 2s 轮询 → ok:刷新关闭;失败:行内人话(行状态
 * failed 同步落库,可在「内容分发」页看记录)。已 synced 再推 = 覆盖公众号侧
 * 草稿,提交前 confirm 明示。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import DialogShell, { DialogActions } from "@/components/admin/DialogShell";
import MediaPicker from "@/components/admin/cover/MediaPicker";
import { field } from "@/components/admin/form-fields";
import { WECHAT_DIGEST_MAX, WECHAT_TITLE_MAX } from "@/lib/distribute/channels";
import type { ApiEnvelope } from "@/lib/http/response";

export interface WechatSyncDialogPost {
  id: string;
  title: string;
  seoTitle: string | null;
  excerpt: string | null;
  seoDescription: string | null;
  coverPath: string | null;
  wechatStatus: string | null;
}

const POLL_MS = 2_000;
const POLL_MAX = 150; // 2s × 150 = 5min:单篇最坏(多图转存)分钟级,兜底轮询

type SyncPollBody = ApiEnvelope<{
  state: "waiting" | "active" | "completed" | "failed";
  ok?: boolean | null;
  mediaId?: string | null;
  reason?: string | null;
} | null>;

export default function SyncWechatDialog({
  post,
  onClose,
}: {
  post: WechatSyncDialogPost;
  onClose: () => void;
}): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [title, setTitle] = useState(post.seoTitle?.trim() || post.title);
  const [digest, setDigest] = useState(post.excerpt?.trim() || post.seoDescription?.trim() || "");
  const [coverPath, setCoverPath] = useState(post.coverPath ?? "");
  const [picking, setPicking] = useState(false);

  const titleLen = [...title].length;
  const digestLen = [...digest].length;
  const canSubmit =
    titleLen >= 1 &&
    titleLen <= WECHAT_TITLE_MAX &&
    digestLen <= WECHAT_DIGEST_MAX &&
    coverPath !== "" &&
    !busy;

  const submit = async (): Promise<void> => {
    if (
      post.wechatStatus === "synced" &&
      !window.confirm("该文章已同步过公众号,重新同步将覆盖公众号侧草稿内容,继续?")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMsg("提交中…");
    try {
      const res = await fetch("/api/distribute/wechat/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          postId: post.id,
          title: title.trim(),
          digest: digest.trim(),
          coverPath,
        }),
      });
      const json = (await res.json().catch(() => null)) as ApiEnvelope<{
        jobId?: string;
        token?: string;
      }> | null;
      if (!res.ok || json?.code !== 0 || !json.data?.jobId || !json.data?.token) {
        setError(json?.message ?? `提交失败(${res.status})`);
        setMsg(null);
        setBusy(false);
        return;
      }
      const { jobId, token } = json.data;
      for (let i = 0; i < POLL_MAX; i += 1) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const poll = await fetch(
          `/api/distribute/wechat/sync/${jobId}?token=${encodeURIComponent(token)}`,
        );
        if (!poll.ok) continue;
        const body = (await poll.json().catch(() => null)) as SyncPollBody | null;
        if (body?.code !== 0 || !body?.data) continue;
        const d = body.data;
        if (d.state === "completed") {
          if (d.ok) {
            onClose();
            router.refresh();
          } else {
            setError(d.reason ?? "同步失败");
            setMsg(null);
            setBusy(false);
          }
          return;
        }
        if (d.state === "failed") {
          setError(d.reason ?? "同步任务失败");
          setMsg(null);
          setBusy(false);
          return;
        }
        setMsg("同步中…(转存正文图片并推送草稿,多图文章约需 1-2 分钟)");
      }
      setError("轮询超时:任务仍在后台执行,稍后到「内容分发」页查看结果");
      setMsg(null);
      setBusy(false);
    } catch {
      setError("网络错误,请重试");
      setMsg(null);
      setBusy(false);
    }
  };

  return (
    <DialogShell width="lg" title="同步到公众号草稿箱">
      <div className="mt-3 flex flex-col gap-3">
        <label className="text-xs text-text-3">
          标题{" "}
          <span className={titleLen > WECHAT_TITLE_MAX ? "text-red" : "text-text-3"}>
            {titleLen}/{WECHAT_TITLE_MAX}
          </span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="text-xs text-text-3">
          摘要{" "}
          <span className={digestLen > WECHAT_DIGEST_MAX ? "text-red" : "text-text-3"}>
            {digestLen}/{WECHAT_DIGEST_MAX}
          </span>
          <textarea
            value={digest}
            onChange={(e) => setDigest(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder="留空回退文章摘要;公众号图文列表展示用"
            className={`mt-1 ${field}`}
          />
        </label>
        <div className="text-xs text-text-3">
          封面(公众号图文必备)
          <div className="mt-1 flex items-start gap-3">
            {coverPath ? (
              // eslint-disable-next-line @next/next/no-img-element -- 管理端封面预览,src 为站内/已存路径
              <img
                src={coverPath}
                alt="封面预览"
                className="h-16 w-28 rounded-sm border border-line object-cover"
              />
            ) : (
              <span className="flex h-16 w-28 items-center justify-center rounded-sm border border-dashed border-line text-[11px] text-amber">
                缺封面
              </span>
            )}
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="w-fit cursor-pointer rounded-sm border border-line px-2.5 py-1.5 text-xs text-text-2 hover:bg-panel-2"
              >
                从媒体库选图
              </button>
              <span className="max-w-[260px] truncate font-mono text-[11px] text-text-3">
                {coverPath || "未设置"}
              </span>
            </div>
          </div>
        </div>
      </div>
      {msg && <p className="mt-2 text-xs text-accent">{msg}</p>}
      {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
      <DialogActions>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2 disabled:opacity-50"
        >
          关闭
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          title={
            coverPath === "" ? "公众号图文必须有封面,先选择封面" : `推送到公众号草稿箱(不自动发布)`
          }
          className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "推送中…" : post.wechatStatus === "synced" ? "重新同步(覆盖)" : "推送草稿"}
        </button>
      </DialogActions>
      {picking && (
        <MediaPicker
          onPick={(it) => {
            setCoverPath(it.path);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </DialogShell>
  );
}
