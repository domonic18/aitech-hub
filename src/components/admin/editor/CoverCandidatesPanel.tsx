"use client";

/**
 * 封面候选面板(编辑器侧,D3 的 HTTP 触发面):按钮「封面 AI」→ 触发生成
 * (POST /api/posts/cover-candidates,服务端入队 cover-gen 并等出图)→ 候选图
 * 预览 → 「入库这张」/「全部放弃」。
 *
 * 为什么不走 agent(2026-11-15):站内创作职责迁到线下后,agent 写工具逐批下线,
 * 但「站内 AI 封面」这条能力保留(D3 裁定)——改由 HTTP 直连,编辑器不再依赖
 * 侧边栏助手在场。与站内 agent 候选卡同一条 hold 口径:候选落临时盘,adopt
 * 时才入库媒体库并设为文章封面。
 *
 * 取图经 fetch 带 x-cover-token 头再转 blob(token 不进 URL,不落访问日志)。
 */
import { useEffect, useState } from "react";

import { COVER_ADOPTED_EVENT } from "@/lib/ai/cover-events";

interface CoverCandidate {
  id: string;
  url: string;
}

/** 单张候选取图(blob 进 objectURL;失败留占位,决策面兜底) */
function CandidateImage({ url, token }: { url: string; token: string }): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let alive = true;
    fetch(url, { headers: { "x-cover-token": token } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`取图失败(${r.status})`))))
      .then((b) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(b);
        setSrc(objectUrl);
      })
      .catch(() => {
        // 取图失败:占位块示意,不影响「放弃」决策
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, token]);

  if (src === null) {
    return <div className="aspect-video w-full animate-pulse bg-panel-2" aria-label="候选加载中" />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- blob 本地回显,无优化面
  return <img src={src} alt="封面候选" className="aspect-video w-full object-cover" />;
}

export default function CoverCandidatesPanel({ postId }: { postId: string }): React.ReactElement {
  const [token, setToken] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CoverCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function generate(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/posts/cover-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      const body = (await res.json()) as {
        code: number;
        message: string;
        data?: { token: string; candidates: CoverCandidate[] };
      };
      if (!res.ok || body.code !== 0 || !body.data) {
        setMsg({ tone: "err", text: body.message || "生成失败" });
        return;
      }
      setToken(body.data.token);
      setCandidates(body.data.candidates);
    } catch {
      setMsg({ tone: "err", text: "生成失败(网络异常)" });
    } finally {
      setBusy(false);
    }
  }

  async function adopt(candidateId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/cover-candidates/${candidateId}/adopt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      const body = (await res.json()) as {
        code: number;
        message: string;
        data?: { path: string; coverSet: boolean; coverError?: string };
      };
      if (!res.ok || body.code !== 0 || !body.data) {
        setMsg({ tone: "err", text: body.message || "入库失败" });
        return;
      }
      // 广播给编辑器刷新封面显示与乐观锁基线(同页面解耦)
      window.dispatchEvent(new CustomEvent(COVER_ADOPTED_EVENT, { detail: { postId } }));
      setMsg({
        tone: "ok",
        text: body.data.coverSet
          ? "已入媒体库并设为文章封面"
          : `封面已入媒体库:${body.data.path};设为文章封面失败(${body.data.coverError ?? "未知错误"}),可在封面设置处手动选用`,
      });
      setToken(null);
      setCandidates([]);
    } catch {
      setMsg({ tone: "err", text: "入库失败(网络异常)" });
    } finally {
      setBusy(false);
    }
  }

  async function discard(): Promise<void> {
    if (busy || !token) return;
    setBusy(true);
    try {
      await fetch("/api/posts/cover-candidates", {
        method: "DELETE",
        headers: { "x-cover-token": token },
      });
    } catch {
      // 放弃失败不阻断:临时件由 cover-gen 队列的 temp-sweep 日频回收
    } finally {
      setBusy(false);
      setToken(null);
      setCandidates([]);
      setMsg({ tone: "ok", text: "已放弃,候选未入库" });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1 rounded-sm border border-line bg-panel px-2 py-2 text-text-2 hover:border-line-hover hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => void generate()}
        disabled={busy}
        title="生成封面候选(约 10-30 秒,出图后挑一张入库)"
      >
        <svg className="ic" aria-hidden="true">
          <use href="#i-picture" />
        </svg>
        {busy && !candidates.length ? "生成中…" : "封面 AI"}
      </button>
      {candidates.length > 0 && token && (
        <div className="w-80 rounded-sm border border-line bg-panel p-2" aria-label="封面候选确认">
          <div className="mb-1.5 grid grid-cols-2 gap-2">
            {candidates.map((c) => (
              <div key={c.id} className="overflow-hidden rounded-sm border border-line">
                <CandidateImage url={c.url} token={token} />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void adopt(c.id)}
                  className="w-full cursor-pointer border-t border-line bg-panel px-2 py-1.5 text-[11px] text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
                >
                  入库这张
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void discard()}
            className="w-full cursor-pointer rounded-sm border border-line px-2.5 py-1 text-[11px] text-text-3 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            全部放弃(不落库)
          </button>
        </div>
      )}
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
