"use client";

/**
 * 站点设置表单(M10 批②):首页电报带条数 1..50 整数,空/越界由服务端
 * Zod 校验返回 400 文案原样展示;PUT /api/site-config。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApiEnvelope } from "@/lib/http/response";

const inputField =
  "w-32 rounded-sm border border-line bg-panel-2 px-2 py-1.5 text-xs text-text-1 outline-none focus:border-accent";

export default function SiteSettingsForm({
  initialBandItemCount,
}: {
  initialBandItemCount: number;
}) {
  const router = useRouter();
  const [bandCount, setBandCount] = useState(String(initialBandItemCount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/site-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bandItemCount: Number(bandCount) }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setNotice("已保存,首页即将按新条数再生");
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent/10 text-accent">
          <svg className="ic ic-sm" aria-hidden="true">
            <use href="#i-setting" />
          </svg>
        </span>
        <b className="text-[13px] text-text-1">前台展示</b>
      </div>
      <label className="mt-3 block text-[11px] text-text-3">
        首页电报流条数(1-50,默认 12)
        <input
          type="number"
          min={1}
          max={50}
          step={1}
          value={bandCount}
          onChange={(e) => setBandCount(e.target.value)}
          aria-label="首页电报流条数"
          className={`mt-1 ${inputField}`}
        />
      </label>
      <p className="mt-2 text-[11px] leading-relaxed text-text-3">
        控制首页 LIVE 带初始展示条数;用户向下滚动到底部会继续自动加载更多。
      </p>
      {error && <p className="mt-2 font-mono text-[11px] text-red">{error}</p>}
      {notice && <p className="mt-2 font-mono text-[11px] text-text-2">{notice}</p>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="cursor-pointer rounded-sm bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        GET/PUT /api/site-config — 配置存 site_config kv(键 band.item_count),后续设置项复用。
      </p>
    </div>
  );
}
