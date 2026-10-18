"use client";

/**
 * 关键词云视图(M34 批③;批② 词动线改造:点词入词库):排布纯函数在
 * lib/insight/word-cloud(测试锚点 packWords);本件只做挂载后 canvas 量测
 * + 渲染(纯客户端,SSR 不出水合差异)。点词 = POST /api/discovery/keywords
 * (origin=manual 直接生效;已在词库 409 带当前状态);反馈条悬于云容器上方,
 * 内联簇详情/候选治理直链与 B站发现就地触发,不打断动线。
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { ApiEnvelope } from "@/lib/http/response";
import type { InsightCloudWord } from "@/lib/insight/hotboard";
import { CLOUD_H, packWords, tierColor, type PlacedWord } from "@/lib/insight/word-cloud";

function useMeasure(): (text: string, px: number) => { w: number; h: number } {
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  return (text: string, px: number) => {
    const ctx = (ctxRef.current ??= document.createElement("canvas").getContext("2d"));
    if (ctx === null) return { w: text.length * px, h: px * 1.15 };
    ctx.font = `600 ${px}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    return { w: ctx.measureText(text).width + 2, h: px * 1.15 };
  };
}

type AddFeedback =
  | { kind: "created"; word: string; clusterId: string }
  | { kind: "exists"; word: string; statusLabel: string }
  | { kind: "error"; word: string; message: string };

export default function KeywordCloud({ words }: { words: InsightCloudWord[] }): React.ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<PlacedWord<InsightCloudWord>[] | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [feedback, setFeedback] = useState<AddFeedback | null>(null);
  const [biliQueued, setBiliQueued] = useState(false);
  const [busyWord, setBusyWord] = useState<string | null>(null);
  const measure = useMeasure();

  useEffect(() => {
    const width = boxRef.current?.clientWidth ?? 0;
    if (width === 0) return;
    const sorted = [...words].sort((a, b) => b.weight - a.weight);
    setPlaced(packWords(sorted, width, CLOUD_H, measure));
    // measure 为稳定闭包(ref 缓存),words 变化重排即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words]);

  /** 点词入词库:归一与幂等在服务端(addManualKeyword);结果内联反馈 */
  async function addToLexicon(w: InsightCloudWord): Promise<void> {
    if (busyWord !== null || added.has(w.word)) return;
    setBusyWord(w.word);
    try {
      const res = await fetch("/api/discovery/keywords", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ word: w.word }),
      });
      const body = (await res.json()) as ApiEnvelope<unknown>;
      if (body.code === 0) {
        setAdded((prev) => new Set(prev).add(w.word));
        setFeedback({ kind: "created", word: w.word, clusterId: w.clusterId });
      } else if (res.status === 409) {
        setFeedback({ kind: "exists", word: w.word, statusLabel: body.message });
      } else {
        setFeedback({ kind: "error", word: w.word, message: body.message });
      }
    } catch {
      setFeedback({ kind: "error", word: w.word, message: "网络异常,请重试" });
    } finally {
      setBusyWord(null);
    }
  }

  /** 就地触发一轮 B站发现(入队即返回,执行与风控节奏在 worker) */
  async function triggerBili(): Promise<void> {
    const res = await fetch("/api/discovery/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job: "bili" }),
    });
    if (res.ok) setBiliQueued(true);
  }

  if (words.length === 0) {
    return (
      <div className="rounded-md border border-line bg-panel px-4 py-6 text-center text-xs text-text-3">
        暂无关键词:簇打标需在 /admin/models 绑定「洞察归纳」模型,日批(03:57)跑完即生成
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {feedback !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs">
          {feedback.kind === "created" && (
            <>
              <span className="text-green">✓ 已入词库「{feedback.word}」,生效词即参与下轮发现</span>
              <Link
                href={`/admin/data/insight/clusters/${feedback.clusterId}`}
                className="text-accent hover:underline"
              >
                查看簇详情
              </Link>
              {biliQueued ? (
                <span className="text-text-3">B站发现已入队</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void triggerBili()}
                  className="rounded-sm bg-accent-dim px-2 py-0.5 font-medium text-accent hover:bg-accent/20"
                >
                  触发 B站发现
                </button>
              )}
              <Link href="/admin/data/mine/?t=candidates" className="text-accent hover:underline">
                去候选治理
              </Link>
            </>
          )}
          {feedback.kind === "exists" && (
            <>
              <span className="text-text-2">{feedback.statusLabel}</span>
              <Link href="/admin/data/sources/?t=words" className="text-accent hover:underline">
                去词库管理
              </Link>
            </>
          )}
          {feedback.kind === "error" && <span className="text-red">{feedback.message}</span>}
        </div>
      )}
      <div
        ref={boxRef}
        className="relative overflow-hidden rounded-md border border-line bg-panel"
        style={{ height: CLOUD_H }}
      >
        {(placed ?? []).map((p) => (
          <button
            key={`${p.word.word}-${p.word.clusterId}`}
            type="button"
            disabled={busyWord !== null}
            onClick={() => void addToLexicon(p.word)}
            title={`${p.word.label} · 机会分 ${p.word.weight}${added.has(p.word.word) ? " · 已在词库" : " · 点击入词库"}`}
            className={`absolute whitespace-nowrap leading-none transition-opacity hover:opacity-100 ${
              p.t >= 0.75 ? "font-semibold" : "font-medium"
            } ${placed === null ? "opacity-0" : "opacity-85"}`}
            style={{
              left: p.x,
              top: p.y,
              fontSize: p.px,
              color: tierColor(p.t),
              transform: `translate(-50%, -50%)${p.vertical ? " rotate(90deg)" : ""}`,
            }}
          >
            {p.word.word}
            {added.has(p.word.word) && <span className="ml-0.5 text-green">✓</span>}
          </button>
        ))}
        {placed !== null && placed.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-text-3">
            词过多无法排布,请收窄窗口
          </div>
        )}
      </div>
    </div>
  );
}
