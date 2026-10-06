"use client";

/**
 * 公众号渠道卡(M17 批①,镜像 AsrCard):单例配置描述网格 + 编辑弹窗 + 测试连接。
 * 测试连接实调 /cgi/bin/token;40164(IP 白名单)错误人话透出(errmsg 自带出口 IP)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { WechatConfigView } from "@/lib/distribute/wechat-config-admin";
import type { ApiEnvelope } from "@/lib/http/response";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";
import WechatConfigDialog from "./WechatConfigDialog";

function TestStatusBadge({
  status,
  latencyMs,
  error,
}: {
  status: string | null;
  latencyMs: number | null;
  error: string | null;
}) {
  if (status === "ok") {
    return (
      <span className="text-green" title={latencyMs != null ? `${latencyMs}ms` : undefined}>
        ✓ {latencyMs ?? "?"}ms
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span className="cursor-help text-red" title={error ?? undefined}>
        ✗ 失败
      </span>
    );
  }
  return <span className="text-text-3">未测试</span>;
}

function Lb({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <>
      <div className="text-[11px] text-text-3">{label}</div>
      <div
        className={`truncate text-[12.5px] text-text-1 ${mono ? "font-mono" : ""}`}
        title={title}
      >
        {value}
      </div>
    </>
  );
}

interface TestOutcome {
  ok: boolean;
  latencyMs: number;
  detail: string;
}

export default function WechatConfigCard({ config }: { config: WechatConfigView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/distribute/wechat-config/test", { method: "POST" });
      const body = (await res.json()) as ApiEnvelope<TestOutcome | null>;
      if (body.code !== 0 || !body.data) {
        setOutcome({ ok: false, latencyMs: 0, detail: body.message || `HTTP ${res.status}` });
        return;
      }
      setOutcome(body.data);
      router.refresh();
    } catch (e) {
      setOutcome({ ok: false, latencyMs: 0, detail: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-md border border-line bg-panel px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
          <svg className="ic text-accent" aria-hidden="true">
            <use href="#i-send" />
          </svg>
          微信公众号 · {config.enabled ? "已启用" : "未启用"}
          {config.enabled && config.autoSyncEnabled && (
            <span className="rounded-sm bg-accent-dim px-1 py-px font-mono text-[10px] text-accent">
              发布自动同步
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="cursor-pointer rounded-sm border border-line px-2 py-1 text-[11px] text-text-2 hover:bg-panel-2"
          >
            编辑配置
          </button>
          <button
            type="button"
            disabled={testing}
            onClick={() => void runTest()}
            className="cursor-pointer rounded-sm bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        <Lb label="AppID" value={config.appid || "—"} mono />
        <Lb label="AppSecret" value={config.appSecretMask ?? "未录入"} mono />
        <Lb label="图文作者" value={config.author ?? "一起AI(缺省)"} />
        <Lb label="自动同步" value={config.autoSyncEnabled ? "发布即推草稿" : "关闭(仅手动)"} />
        <Lb
          label="最后测试"
          value={
            <TestStatusBadge
              status={config.lastTestStatus}
              latencyMs={config.lastTestLatencyMs}
              error={config.lastTestError}
            />
          }
        />
      </div>

      <div className="mt-3 text-[11px] leading-relaxed text-text-3">
        <svg className="ic ic-sm mr-1 inline align-[-2px] text-text-3" aria-hidden="true">
          <use href="#i-infocircle" />
        </svg>
        测试为实调 <code>GET /cgi-bin/token</code>;若报「IP 不在白名单」,把提示中的 IP 加入
        <b className="text-text-2">「公众号后台-设置与开发-基本配置-IP 白名单」</b>
        后重试(本机与生产服务器出口 IP 都需加白)。
      </div>

      {outcome && (
        <div
          className={`mt-2 font-mono text-xs ${outcome.ok ? "whitespace-pre-wrap text-green" : "whitespace-pre-wrap text-red"}`}
        >
          {outcome.ok ? "✓ " : "✗ "}
          {outcome.detail}
        </div>
      )}

      {open && <WechatConfigDialog config={config} onClose={() => setOpen(false)} />}
    </div>
  );
}
