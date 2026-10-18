"use client";

/**
 * 关键词云视图(M34 批③;验收反馈·问题3 行业词云形态):排布纯函数在
 * lib/insight/word-cloud(测试锚点 packWords);本件只做挂载后 canvas 量测
 * + 渲染(纯客户端,SSR 不出水合差异)。
 */
import { useEffect, useRef, useState } from "react";

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

export default function KeywordCloud({ words }: { words: InsightCloudWord[] }): React.ReactElement {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<PlacedWord[] | null>(null);
  const measure = useMeasure();

  useEffect(() => {
    const width = boxRef.current?.clientWidth ?? 0;
    if (width === 0) return;
    const sorted = [...words].sort((a, b) => b.weight - a.weight);
    setPlaced(packWords(sorted, width, CLOUD_H, measure));
    // measure 为稳定闭包(ref 缓存),words 变化重排即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words]);

  if (words.length === 0) {
    return (
      <div className="rounded-md border border-line bg-panel px-4 py-6 text-center text-xs text-text-3">
        暂无关键词:簇打标需在 /admin/models 绑定「洞察归纳」模型,日批(03:57)跑完即生成
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
        <a
          key={`${p.word.word}-${p.word.clusterId}`}
          href={`/admin/insight/clusters/${p.word.clusterId}`}
          title={`${p.word.label} · 机会分 ${p.word.weight}`}
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
        </a>
      ))}
      {placed !== null && placed.length === 0 && (
        <div className="flex h-full items-center justify-center text-xs text-text-3">
          词过多无法排布,请收窄窗口
        </div>
      )}
    </div>
  );
}
