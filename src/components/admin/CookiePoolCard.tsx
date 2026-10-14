"use client";

/**
 * Cookie 池状态卡(M8 批③;M24 每平台一行):jar 数/脱敏关键 cookie 前缀/
 * 导入/清空。导入弹窗锚定平台(bilibili 推荐已登录完整复制,字幕优先依赖登录态,
 * 文案与 placeholder per-platform);Cookie 值只写不读:textarea 粘完整 Cookie,
 * 提交后即刻清空不回显。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { VIDEO_PLATFORM_BILIBILI, VIDEO_PLATFORM_DOUYIN } from "@/lib/telegram/constants";
import type { CookiePoolView } from "@/lib/telegram/social-platform-admin";
import type { ApiEnvelope } from "@/lib/http/response";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

/** 平台行展示元数据(pools 未落行的平台也渲染,导入即建行) */
const PLATFORM_META: Record<string, { label: string; placeholder: string; hint: string }> = {
  [VIDEO_PLATFORM_DOUYIN]: {
    label: "抖音",
    placeholder: "ttwid=…; sessionid=…; msToken=…",
    hint: "从已登录抖音的浏览器完整复制 Cookie 请求头(须含 ttwid,≥3 组键值对); 同 ttwid 视为同身份,重复导入覆盖旧值。保存后立即加密,不再回显。",
  },
  [VIDEO_PLATFORM_BILIBILI]: {
    label: "B站",
    placeholder: "SESSDATA=…; buvid3=…; buvid4=…; b_nut=…",
    hint: "推荐从已登录 B 站的浏览器完整复制 Cookie 请求头(含 SESSDATA:字幕优先通道依赖登录态才能拿到 AI 字幕;游客 Cookie 仅够直链兜底); 同 buvid3 视为同身份,重复导入覆盖旧值。保存后立即加密,不再回显。",
  },
};

const KNOWN_PLATFORMS = [VIDEO_PLATFORM_DOUYIN, VIDEO_PLATFORM_BILIBILI] as const;

export default function CookiePoolCard({ pools }: { pools: CookiePoolView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>(VIDEO_PLATFORM_DOUYIN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cookie, setCookie] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const meta = PLATFORM_META[target] ?? PLATFORM_META[VIDEO_PLATFORM_DOUYIN]!;

  const close = (): void => {
    setOpen(false);
    setError(null);
    setCookie("");
  };

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bloggers/cookies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: target, cookie: cookie.trim() }),
      });
      const body = (await res.json()) as {
        code: number;
        message: string;
        data?: { jarCount: number };
      };
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setNotice(`导入成功,${meta.label}池当前 ${body.data?.jarCount ?? "?"} 份 jar`);
      close();
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearPool(platform: string): Promise<void> {
    const label = PLATFORM_META[platform]?.label ?? platform;
    if (!confirm(`确认清空${label} Cookie 池?采集将跳过并提示「Cookie 池为空」。`)) return;
    try {
      const res = await fetch(`/api/bloggers/cookies?platform=${platform}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        alert(`清空失败:${body.message}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-line bg-panel px-4 py-4">
      <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
        <svg className="ic text-accent" aria-hidden="true">
          <use href="#i-key" />
        </svg>
        Cookie 池(抖音/B站)
      </div>
      <div className="mt-2 space-y-2.5">
        {KNOWN_PLATFORMS.map((platform) => {
          const pool = pools.find((p) => p.platform === platform);
          const rowMeta = PLATFORM_META[platform]!;
          const jarCount = pool?.jarCount ?? 0;
          return (
            <div key={platform} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-text-1">
                  {rowMeta.label}
                  <span className="ml-1.5 font-mono text-[13px] font-bold text-text-1">
                    {jarCount}
                  </span>
                  <span className="ml-0.5 text-[10px] text-text-3">份 jar</span>
                  {jarCount === 1 && (
                    <span
                      className="ml-1.5 rounded-sm bg-amber/10 px-1 py-px text-[10px] text-amber"
                      title="单份 jar 是单点:任一视频触发风控冷却,该平台采集/解读全部暂停直至冷却到期;建议再导入一份不同身份的 Cookie 分摊风险"
                    >
                      单点:建议 ≥2 份
                    </span>
                  )}
                  {!pool?.enabled && pool && (
                    <span className="ml-1.5 rounded-sm bg-amber/10 px-1 py-px text-[10px] text-amber">
                      平台已停用
                    </span>
                  )}
                </div>
                <div
                  className="mt-0.5 truncate font-mono text-[11px] text-text-3"
                  title={pool?.masked.map((m) => m.essentialPrefix).join(", ")}
                >
                  {jarCount > 0
                    ? pool!.masked.map((m) => `${m.essentialKey}:${m.essentialPrefix}…`).join("  ")
                    : "待导入"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setTarget(platform);
                    setOpen(true);
                  }}
                  className="cursor-pointer rounded-sm border border-line px-2 py-1 text-[11px] text-text-2 hover:bg-panel-2"
                >
                  导入
                </button>
                {jarCount > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void clearPool(platform)}
                    className="cursor-pointer rounded-sm px-2 py-1 text-[11px] text-red hover:bg-red/10 disabled:opacity-50"
                  >
                    清空
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div
        className="mt-2 text-[11px] text-text-3"
        title="AUTH_SECRET 轮换会使已存密文失效,需重导 Cookie"
      >
        密钥来源:AUTH_SECRET 派生(AES-256-GCM)
      </div>
      {notice && <div className="mt-1.5 text-[11px] text-green">{notice}</div>}

      {open && (
        <DialogShell width="lg" title={`导入${meta.label} Cookie`}>
          <p className="mt-1 text-[11px] leading-relaxed text-text-3">{meta.hint}</p>
          <textarea
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            rows={6}
            placeholder={meta.placeholder}
            className="mt-3 w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 font-mono text-xs text-text-1 outline-none focus:border-accent placeholder:text-text-3"
          />
          {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
          <DialogActions>
            <button
              type="button"
              onClick={close}
              className="rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || cookie.trim().length < 10}
              onClick={() => void submit()}
              className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "导入中…" : "导入"}
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </div>
  );
}
