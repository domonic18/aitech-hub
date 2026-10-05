"use client";

/**
 * 清理明细按钮(M14 批⑦,原型「清理明细」):confirm 二次确认 →
 * POST /api/usage/purge 清 90 天前台账,回显删除行数并刷新看板。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UsagePurgeButton(): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const purge = async (): Promise<void> => {
    if (
      !window.confirm("清理 90 天前的 AI 用量明细(保留期外聚合不可恢复,费用参考口径按现行牌价)?")
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/usage/purge", { method: "POST" });
      const body = (await res.json()) as {
        code?: number;
        message?: string;
        data?: { removed?: number };
      };
      if (res.ok && body.code === 0) {
        window.alert(`已清理 ${body.data?.removed ?? 0} 行 90 天前用量明细`);
        router.refresh();
      } else {
        window.alert(`清理失败:${body.message ?? `HTTP ${res.status}`}`);
      }
    } catch (e) {
      window.alert(`清理失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void purge()}
      disabled={busy}
      className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-panel px-3.5 text-[13px] text-text-2 transition-colors hover:border-border-hover hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg className="ic ic-sm" aria-hidden="true">
        <use href="#i-delete" />
      </svg>
      {busy ? "清理中…" : "清理明细"}
    </button>
  );
}
