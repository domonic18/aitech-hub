"use client";

/**
 * 关键词云视图(M34 批③;批② 词动线改造:点词入词库;M46 验收批·舆情四色):
 * 排布纯函数在 lib/insight/word-cloud(测试锚点 packWords);本件只做挂载后
 * canvas 量测 + 渲染(纯客户端,SSR 不出水合差异)。字号=机会分(权重档定
 * 字号/字重),颜色=簇舆情倾向(正面绿/中性灰/负面红/争议琥珀,未打标按中性);
 * 图例 chips 即筛选(点切该情绪面,再点还原全部)。点词 = POST
 * /api/discovery/keywords(origin=manual 直接生效;已在词库 409 带当前状态);
 * 反馈条悬于云容器上方,内联簇详情/候选治理直链与 B站发现就地触发,不打断动线。
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ApiEnvelope } from "@/lib/http/response";
import { SENTIMENT_LABELS, type InsightSentiment } from "@/lib/insight/constants";
import type { InsightCloudWord } from "@/lib/insight/hotboard";
import {
  CLOUD_H,
  SENTIMENT_LEGEND,
  packWords,
  sentimentColor,
  sentimentOf,
  type PlacedWord,
} from "@/lib/insight/word-cloud";

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

/** 搜索过滤:词形(归一)与打标 label 双匹配;空串原样返回 */
function searchTrim(q: string, words: InsightCloudWord[]): InsightCloudWord[] {
  const s = q.trim().toLowerCase();
  if (s === "") return words;
  return words.filter((w) => w.word.includes(s) || (w.label ?? "").toLowerCase().includes(s));
}

/** 图例 chip 配色(与 sentimentColor 同源:活性=色底色字,闲置=灰底+彩点) */
const LEGEND_ACTIVE_CLS: Record<InsightSentiment, string> = {
  positive: "bg-green/12 text-green",
  neutral: "bg-panel-2 text-text-1",
  negative: "bg-red/12 text-red",
  mixed: "bg-amber/12 text-amber-hi",
};
const LEGEND_DOT_CLS: Record<InsightSentiment, string> = {
  positive: "bg-green-hi",
  neutral: "bg-text-2",
  negative: "bg-red-hi",
  mixed: "bg-amber-hi",
};

export default function KeywordCloud({ words }: { words: InsightCloudWord[] }): React.ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<PlacedWord<InsightCloudWord>[] | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [feedback, setFeedback] = useState<AddFeedback | null>(null);
  const [biliQueued, setBiliQueued] = useState(false);
  const [busyWord, setBusyWord] = useState<string | null>(null);
  /** 板定搜索框(F11 云图卡):客户端过滤,归一形与打标词双匹配 */
  const [search, setSearch] = useState("");
  /** 图例筛选(M46 验收批):点切该舆情面,再点还原全部(null=全部) */
  const [sentFilter, setSentFilter] = useState<InsightSentiment | null>(null);
  const measure = useMeasure();

  /** 图例计数:全量词按舆情面统计(null 计入中性,与着色同口径) */
  const legendCounts = new Map<InsightSentiment, number>();
  for (const w of words) {
    const s = sentimentOf(w.sentiment);
    legendCounts.set(s, (legendCounts.get(s) ?? 0) + 1);
  }

  /** useMemo 钉住引用:filter 每轮都出新数组,裸写会令下方 useEffect([shown])
   * 连同 setPlaced 组成无限重渲染循环(主线程打满,页内所有链接点击无响应,
   * 2026-10-24 验收实测)——搜索词/图例筛选取值不变时必须保持同一引用。 */
  const shown = useMemo(
    () =>
      searchTrim(search, words).filter(
        (w) => sentFilter === null || sentimentOf(w.sentiment) === sentFilter,
      ),
    [words, search, sentFilter],
  );

  useEffect(() => {
    const width = boxRef.current?.clientWidth ?? 0;
    if (width === 0) return;
    const sorted = [...shown].sort((a, b) => b.weight - a.weight);
    setPlaced(packWords(sorted, width, CLOUD_H, measure));
    // measure 为稳定闭包(ref 缓存),shown 变化重排即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

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
        暂无关键词:簇打标需在
        <Link href="/admin/models" className="mx-0.5 text-accent hover:underline">
          AI 配置
        </Link>
        绑定「洞察归纳」模型,日批(03:57)跑完即生成
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
                href={`/admin/insight/clusters/${feedback.clusterId}`}
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
              <Link
                href="/admin/data/sources/?t=candidates"
                className="text-accent hover:underline"
              >
                去候选治理
              </Link>
            </>
          )}
          {feedback.kind === "exists" && (
            <>
              <span className="text-text-2">{feedback.statusLabel}</span>
              <Link
                href="/admin/insight/discovery/?t=words"
                className="text-accent hover:underline"
              >
                去词库管理
              </Link>
            </>
          )}
          {feedback.kind === "error" && <span className="text-red">{feedback.message}</span>}
        </div>
      )}
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索词…"
        aria-label="搜索云图关键词"
        className="w-full rounded-sm border border-line bg-panel px-3 py-1.5 text-xs text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none"
      />
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
            title={`${p.word.label} · 机会分 ${p.word.weight} · 舆情${SENTIMENT_LABELS[sentimentOf(p.word.sentiment)]}${added.has(p.word.word) ? " · 已在词库" : " · 点击入词库"}`}
            className={`absolute whitespace-nowrap leading-none transition-opacity hover:opacity-100 ${
              p.t >= 0.75 ? "font-semibold" : "font-medium"
            } ${placed === null ? "opacity-0" : "opacity-85"}`}
            style={{
              left: p.x,
              top: p.y,
              fontSize: p.px,
              color: sentimentColor(p.word.sentiment),
              transform: `translate(-50%, -50%)${p.vertical ? " rotate(90deg)" : ""}`,
            }}
          >
            {p.word.word}
            {added.has(p.word.word) && <span className="ml-0.5 text-green">✓</span>}
          </button>
        ))}
        {placed !== null && placed.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-text-3">
            {shown.length === 0 && words.length > 0 ? "无匹配词" : "词过多无法排布,请收窄窗口"}
          </div>
        )}
      </div>
      {/* 图例行(M46 验收批,F11 板定):chips 即筛选 + 读法提示;null=全部 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SENTIMENT_LEGEND.map(({ key, label }) => {
          const active = sentFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSentFilter(active ? null : key)}
              title={`只看${label}词,再点还原全部`}
              className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[11px] ${
                active ? LEGEND_ACTIVE_CLS[key] : "bg-panel-2 text-text-2 hover:text-text-1"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${LEGEND_DOT_CLS[key]}`} />
              {label}
              <span className="font-mono text-text-3">{legendCounts.get(key) ?? 0}</span>
            </button>
          );
        })}
        <span className="ml-auto text-[11px] text-text-3">
          字号 = 机会分 · 颜色 = 舆情倾向(LLM 打标) · 点词加入种子词库
        </span>
      </div>
    </div>
  );
}
