"use client";

/**
 * 表格行启用开关(原型 .sw 胶囊开关 36×20,2026-10-06 验收反馈问题3/4:
 * 渠道/博主台账补「启用」开关列,替代行内文字启停钮):
 * PUT {endpoint} {enabled} → router.refresh;停用有 confirm,失败 alert。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ApiEnvelope } from "@/lib/http/response";

export default function StatusSwitch({
  endpoint,
  enabled,
  name,
  disableHint,
}: {
  endpoint: string;
  enabled: boolean;
  name: string;
  disableHint: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle(): Promise<void> {
    const next = !enabled;
    if (!next && !confirm(disableHint)) return;
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        alert(`操作失败:${body.message}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${name} 启用开关`}
      disabled={busy}
      onClick={() => void toggle()}
      className={`relative h-5 w-9 flex-none cursor-pointer rounded-full border transition-colors disabled:opacity-50 ${
        enabled ? "border-accent bg-accent" : "border-line bg-panel-2"
      }`}
    >
      <span
        className={`absolute left-[1px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? "translate-x-[16px]" : ""
        }`}
      />
    </button>
  );
}
