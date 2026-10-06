"use client";
/**
 * AI 答案卡(K2 批③,arch/04 §3.4;原型 site-search .ai-card):
 * fetch + getReader 手解 SSE——禁 EventSource(自动重连会对同一问题重复计费)。
 * 事件流 meta→delta*→done;unavailable 任意时刻整体不渲染(前台无感)。
 * done 广播 search:answer-done(detail.durationMs)供 GenTime 填「生成 X.Xs」;
 * 追问 chips 走整页导航 Link(规避换参不刷新);角标 [n] 锚跳引用列表,
 * 站内引用为内链、电报/repo 外链新窗。
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { parseAnswerSup, type SupSegment } from "@/lib/search/answer-parse";
import { parseSseBlocks, type AnswerCite } from "@/lib/search/answer-protocol";

type Phase = "hidden" | "streaming" | "done";

const KIND_LABEL: Record<AnswerCite["kind"], string> = {
  "feed-text": "电报",
  "feed-video": "短视频解读",
  post: "博主文章",
  repo: "项目",
};

/** 外链 kind(电报/repo 原样新窗;post 为站内 /post/<id>-<slug>/ 内链) */
function isExternal(kind: AnswerCite["kind"]): boolean {
  return kind !== "post";
}

/** [n]/[n][m] → 上标锚(锚跳引用列表;纯文本段原样) */
function renderAnswer(segs: SupSegment[]): React.ReactNode[] {
  return segs.map((s, i) =>
    typeof s === "string" ? (
      <span key={i}>{s}</span>
    ) : (
      <span key={i}>
        {s.sup.map((n) => (
          <sup key={n}>
            <a
              href={`#cite-${n}`}
              className="mx-0.5 rounded-[3px] bg-accent-dim px-1 font-mono text-[10.5px] text-accent-hover hover:border hover:border-accent/40"
            >
              [{n}]
            </a>
          </sup>
        ))}
      </span>
    ),
  );
}

export default function AnswerCard({ q }: { q: string }): React.ReactElement | null {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [meta, setMeta] = useState<{
    total: number;
    noHits: boolean;
    generatedAt: string;
  } | null>(null);
  const [cites, setCites] = useState<AnswerCite[]>([]);
  const [text, setText] = useState("");
  const [followUps, setFollowUps] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (q === "") return undefined;
    const abort = new AbortController();
    abortRef.current = abort;
    let buf = "";
    (async (): Promise<void> => {
      try {
        const res = await fetch(`/api/search/answer/?q=${encodeURIComponent(q)}`, {
          signal: abort.signal,
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parsed = parseSseBlocks(buf);
          buf = parsed.rest;
          let stop = false;
          for (const ev of parsed.events) {
            if (ev.type === "meta") {
              setMeta({ total: ev.total, noHits: ev.noHits, generatedAt: ev.generatedAt });
              setCites(ev.cites);
              setPhase("streaming");
            } else if (ev.type === "delta") {
              setText((t) => t + ev.text);
            } else if (ev.type === "done") {
              setFollowUps(ev.followUps);
              setPhase("done");
              window.dispatchEvent(
                new CustomEvent("search:answer-done", { detail: { durationMs: ev.durationMs } }),
              );
              stop = true; // 服务端随即关流,提前收工不再读
            } else {
              setPhase("hidden"); // unavailable:前台无感
              stop = true;
            }
          }
          if (stop) break;
        }
      } catch {
        /* 客户端 abort / 网络中断:静默保持现状 */
      }
    })();
    return () => abort.abort();
  }, [q]);

  if (phase === "hidden") return null;
  const feedText = cites.filter((c) => c.kind === "feed-text").length;
  const feedVideo = cites.filter((c) => c.kind === "feed-video").length;
  return (
    <div className="mb-[30px] rounded-lg border border-accent/35 bg-panel px-6 py-[22px] md:px-[26px]">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="rounded-full border border-accent/35 bg-accent-dim px-3 py-0.5 font-mono text-[11.5px] text-accent-hover">
          <svg className="ic ic-sm" aria-hidden="true">
            <use href="#i-robot" />
          </svg>{" "}
          AI 回答
        </span>
        {meta ? (
          <span className="font-mono text-[11.5px] text-text-3">
            {meta.noHits ? (
              <>
                站内无命中 · <b className="text-green-hi">AI 直接作答</b> · {meta.generatedAt} 生成
              </>
            ) : (
              <>
                基于站内 <b className="text-text-2">{meta.total}</b> 条内容(文字 {feedText} ·
                短视频解读 {feedVideo})· {meta.generatedAt} 生成
              </>
            )}
          </span>
        ) : null}
      </div>

      <p className="text-[14.5px] leading-[1.85] text-text-1">
        {text !== "" ? (
          renderAnswer(parseAnswerSup(text))
        ) : (
          <span className="text-text-3">正在生成…</span>
        )}
        {phase === "streaming" ? (
          <span className="ml-0.5 inline-block h-[1em] w-[7px] translate-y-[2px] animate-pulse bg-green-hi" />
        ) : null}
      </p>

      {cites.length > 0 ? (
        <div className="mt-3.5 border-t border-dashed border-line pt-3 font-mono text-xs leading-[2] text-text-3">
          引用来源:
          {cites.map((c) => (
            <a
              key={c.n}
              id={`cite-${c.n}`}
              href={c.href}
              {...(isExternal(c.kind) ? { target: "_blank", rel: "noopener nofollow" } : {})}
              className="mr-3.5 border-b border-dashed border-line text-text-2 hover:border-accent-hover hover:text-accent-hover"
            >
              [{c.n}] {KIND_LABEL[c.kind]} · {c.title}
            </a>
          ))}
        </div>
      ) : null}

      {phase === "done" && followUps.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-text-3">
          追问:
          {followUps.map((f) => (
            <Link
              key={f}
              href={`/search/?q=${encodeURIComponent(f)}`}
              className="rounded-full border border-line bg-panel-2 px-3 py-[3px] font-mono text-xs text-text-2 hover:border-line-hover hover:text-text-1"
            >
              {f}
            </Link>
          ))}
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="mt-3 font-mono text-[11px] text-text-3">
          <svg className="ic ic-sm" aria-hidden="true">
            <use href="#i-robot" />
          </svg>{" "}
          AI 生成,可能存在错误
          {meta?.noHits
            ? ";站内无命中,以下为通用回答、无站内来源"
            : ";角标 [n] 可溯源到站内原文,点击即跳转"}
        </div>
      ) : null}
    </div>
  );
}
