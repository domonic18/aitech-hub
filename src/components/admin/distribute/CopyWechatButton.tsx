"use client";

/**
 * 「复制公众号格式」备用通道按钮(M31 批④):两段式——①入队+轮询(转存
 * 图片约 10-60s,完成后持有 mmbiz 图链 HTML);②「写入剪贴板」按钮在用户
 * 手势内写 ClipboardItem text/html(轮询回调里直接写会被非手势上下文拒)。
 * 粘贴目标=公众号后台「新的图文」正文区:图片已转存零再传;封面已入永久
 * 素材库(coverReady 时提示从素材库选择)。与草稿推送互不影响(无码点门)。
 */
import { useCallback, useRef, useState } from "react";

import { pollJobUntil } from "@/lib/http/poll-client";
import type { ApiEnvelope } from "@/lib/http/response";

const POLL_MS = 2_000;
const POLL_MAX = 150; // 2s × 150 = 5min:多图文章转存最坏分钟级

/** 轮询 data 载荷(包络由 pollJobUntil 剥) */
type CopyPollData = {
  state: "waiting" | "active" | "completed" | "failed";
  ok?: boolean | null;
  html?: string | null;
  chars?: number | null;
  coverReady?: boolean | null;
  reason?: string | null;
};

type CopyPhase = "idle" | "running" | "ready" | "copied";

export default function CopyWechatButton({
  postId,
  coverPath,
  theme,
}: {
  postId: string;
  coverPath: string;
  theme: string | null;
}): React.ReactElement {
  const [phase, setPhase] = useState<CopyPhase>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const htmlRef = useRef<string | null>(null);
  const coverReadyRef = useRef(false);

  const start = useCallback(async (): Promise<void> => {
    setPhase("running");
    setError(null);
    setMsg("渲染中…(转存正文图片,约 10-60 秒)");
    try {
      const res = await fetch("/api/distribute/wechat/copy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          postId,
          ...(coverPath ? { coverPath } : {}),
          ...(theme ? { theme } : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as ApiEnvelope<{
        jobId?: string;
        token?: string;
      }> | null;
      if (!res.ok || json?.code !== 0 || !json.data?.jobId || !json.data?.token) {
        setError(json?.message ?? `提交失败(${res.status})`);
        setMsg(null);
        setPhase("idle");
        return;
      }
      const { jobId, token } = json.data;
      const d = await pollJobUntil<CopyPollData>(
        `/api/distribute/wechat/copy/${jobId}?token=${encodeURIComponent(token)}`,
        {
          pollMs: POLL_MS,
          pollMax: POLL_MAX,
          isTerminal: (x) => x.state === "completed" || x.state === "failed",
        },
      );
      if (d?.state === "completed") {
        if (d.ok && d.html) {
          htmlRef.current = d.html;
          coverReadyRef.current = d.coverReady === true;
          setMsg(null);
          setPhase("ready");
        } else {
          setError(d.reason ?? "生成失败");
          setMsg(null);
          setPhase("idle");
        }
        return;
      }
      if (d) {
        setError(d.reason ?? "任务失败");
        setMsg(null);
        setPhase("idle");
        return;
      }
      setError("轮询超时:任务仍在后台执行,稍后重试(图片转存已缓存,会更快)");
      setMsg(null);
      setPhase("idle");
    } catch {
      setError("网络错误,请重试");
      setMsg(null);
      setPhase("idle");
    }
  }, [postId, coverPath, theme]);

  /** 写剪贴板必须在用户手势内(轮询回调非手势上下文会被拒),故两段式 */
  const writeClipboard = useCallback(async (): Promise<void> => {
    const html = htmlRef.current;
    if (!html) return;
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      setError("当前浏览器不支持剪贴板写入,请使用 Chrome/Edge");
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": html })]);
      setPhase("copied");
      setError(null);
    } catch {
      setError("剪贴板写入被拒绝,请允许剪贴板权限后重试");
    }
  }, []);

  const label =
    phase === "running"
      ? "渲染中…"
      : phase === "ready"
        ? "写入剪贴板"
        : phase === "copied"
          ? "已复制 ✓"
          : "复制公众号格式";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={phase === "running"}
        onClick={() => void (phase === "ready" ? writeClipboard() : start())}
        title="备用通道:生成公众号排版 HTML 并复制,粘贴进公众号编辑器(无码点门,适合超预算富稿)"
        className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {label}
      </button>
      {phase === "copied" && msg === null && (
        <p className="max-w-[320px] text-right text-[11px] leading-relaxed text-accent">
          到公众号后台「新的图文」正文区粘贴即得成品
          {coverReadyRef.current ? ";封面已入素材库,请在编辑器封面处从素材库选择" : ""}。
        </p>
      )}
      {msg && <p className="text-[11px] text-accent">{msg}</p>}
      {error && <p className="max-w-[320px] text-right font-mono text-[11px] text-red">{error}</p>}
    </div>
  );
}
