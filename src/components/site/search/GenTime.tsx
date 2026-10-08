"use client";
/**
 * result-head「生成 X.Xs」(K2 批③,原型 result-head 同位):AnswerCard 收到
 * done 时广播 search:answer-done(detail.durationMs),此处填耗时;
 * unavailable/未生成保持空(检索 N 条为 SSR 直出,不依赖本件)。
 */
import { useEffect, useState } from "react";

export default function GenTime(): React.ReactElement | null {
  const [sec, setSec] = useState<number | null>(null);
  useEffect(() => {
    const on = (e: Event): void => {
      const ms = (e as CustomEvent<{ durationMs: number }>).detail.durationMs;
      setSec(ms / 1000);
    };
    window.addEventListener("search:answer-done", on);
    return () => window.removeEventListener("search:answer-done", on);
  }, []);
  if (sec == null) return null;
  return (
    <>
      生成 <b className="text-green-hi">{sec.toFixed(1)}s</b>{" "}
    </>
  );
}
