"use client";

/**
 * 运行页实时刷新(F18/F20 板「运行中每 3 秒自动刷新」):有运行中任务时每
 * 3s router.refresh() 拉新 RSC;无任务退化为手动刷新钮。纯客户端表现层,
 * 取数仍在服务端组件。F19「立即检测」复用同款手动钮。
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 自动刷新指示 + 手动刷新钮(● 运行中 N · 每 3 秒自动刷新 | 刷新;
 *  actionLabel 供非日志页换文案,如健康页「立即检测」) */
export default function LiveRefresher({
  running,
  actionLabel = "刷新",
}: {
  running: number;
  actionLabel?: string;
}): React.ReactElement {
  const router = useRouter();
  useEffect(() => {
    if (running <= 0) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [running, router]);

  return (
    <span className="flex items-center gap-2.5">
      {running > 0 && (
        <span className="flex items-center gap-1.5 text-[11px] text-amber">
          <i className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />● 运行中{" "}
          {running} · 每 3 秒自动刷新
        </span>
      )}
      <button
        type="button"
        onClick={() => router.refresh()}
        className="cursor-pointer rounded-sm border border-line bg-panel px-2 py-0.5 text-[11px] text-text-2 hover:border-line-hover hover:text-text-1"
      >
        {actionLabel}
      </button>
    </span>
  );
}
