"use client";

/**
 * 词库效能云(批② 词动线):字重=候选产出(批准×3 加权),hover 看产出明细,
 * 点词跳「挖掘·候选治理」按词过滤——词的产出一屏见「重心」。排布复用
 * lib/insight/word-cloud 泛型 packWords(与洞察簇词云同一套视觉语言);
 * 客户端 canvas 量测 + 渲染(SSR 不出水合差异)。
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { KeywordYield } from "@/lib/discovery/word-yield";
import { keywordYieldWeight } from "@/lib/discovery/word-yield";
import { CLOUD_H, packWords, tierColor, type PlacedWord } from "@/lib/insight/word-cloud";

type YieldWord = KeywordYield & { weight: number };

/** useMeasure 同源实现见 insight/KeywordCloud(8 行小钩子,不抽共享件) */
function useMeasure(): (text: string, px: number) => { w: number; h: number } {
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  return (text: string, px: number) => {
    const ctx = (ctxRef.current ??= document.createElement("canvas").getContext("2d"));
    if (ctx === null) return { w: text.length * px, h: px * 1.15 };
    ctx.font = `600 ${px}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    return { w: ctx.measureText(text).width + 2, h: px * 1.15 };
  };
}

function fmtPlay(n: number | null): string {
  if (n === null) return "—";
  return n >= 10000 ? `${(n / 10000).toFixed(1)}w` : n.toLocaleString("en-US");
}

export default function WordYieldCloud({ yields }: { yields: KeywordYield[] }): React.ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<PlacedWord<YieldWord>[] | null>(null);
  const measure = useMeasure();

  useEffect(() => {
    const width = boxRef.current?.clientWidth ?? 0;
    if (width === 0) return;
    const words: YieldWord[] = yields.map((y) => ({ ...y, weight: keywordYieldWeight(y) }));
    const sorted = words.sort((a, b) => b.weight - a.weight);
    setPlaced(packWords(sorted, width, CLOUD_H, measure));
    // measure 为稳定闭包(ref 缓存),yields 变化重排即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yields]);

  if (yields.length === 0) {
    return (
      <div className="rounded-md border border-line bg-panel px-4 py-6 text-center text-xs text-text-3">
        暂无产出数据:生效词跑过一轮「B站发现」后,这里按产出显示词的重心
      </div>
    );
  }
  return (
    <div
      ref={boxRef}
      className="relative overflow-hidden rounded-md border border-line bg-panel"
      style={{ height: CLOUD_H }}
    >
      {(placed ?? []).map((p) => (
        <Link
          key={p.word.word}
          href={`/admin/data/sources/?t=candidates&kw=${encodeURIComponent(p.word.word)}`}
          title={`候选 ${p.word.candidates} · 批准 ${p.word.approved} · 最高播放 ${fmtPlay(p.word.maxPlay)} —— 点击按词过滤候选`}
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
        </Link>
      ))}
      {placed !== null && placed.length === 0 && (
        <div className="flex h-full items-center justify-center text-xs text-text-3">
          词过多无法排布,请收窄窗口
        </div>
      )}
    </div>
  );
}
