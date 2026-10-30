"use client";

/**
 * F17 采集渠道台账行(客户端):渠道名 + 备注 + 自动调度 + 健康 + 最近运行 +
 * 手动触发。主钮按行类型分发到既有 API(渠道 crawl/博主 crawl/热榜 trigger/
 * 发现 trigger/github sync),「采集中」行以秒表呈现并给「查看实时」跳转;
 * 试拉/调试弹结果不入库(同 ChannelRowOps 口径)。行组件自持刷新(router),
 * 分节与筛选壳在 ChannelLedgerTable(≤350 行拆分,2026-10-30 分组改造)。
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import ChannelDialog from "@/components/admin/ChannelDialog";
import StatusSwitch from "@/components/admin/StatusSwitch";
import type { ApiEnvelope } from "@/lib/http/response";
import type { ChannelDebugResult } from "@/lib/telegram/channels-admin";
import type {
  ChannelLedgerRow,
  LedgerHealth,
  LedgerPrimaryAction,
} from "@/lib/collect/channel-ledger-types";

const HEALTH_STYLE: Record<LedgerHealth, string> = {
  healthy: "bg-green",
  fail: "bg-red",
  degraded: "bg-amber",
  paused: "bg-line",
};
const HEALTH_TEXT: Record<LedgerHealth, string> = {
  healthy: "text-green",
  fail: "text-red",
  degraded: "text-amber",
  paused: "text-text-3",
};

async function post(url: string, body?: unknown): Promise<ApiEnvelope> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return (await res.json()) as ApiEnvelope;
}

/** 逐个入队(平台立即采集 = 逐博主;GitHub 立即同步 = 逐仓);全败/部分败提示 */
async function postEach(ids: number[], urlOf: (id: number) => string): Promise<string | null> {
  let failed = 0;
  for (const id of ids) {
    const body = await post(urlOf(id));
    if (body.code !== 0) failed += 1;
  }
  return failed === 0 ? null : `${failed}/${ids.length} 个触发失败`;
}

/** 「● 采集中 mm:ss」秒表(processedOn 起算;挂钟走客户端,与队列口径秒级一致) */
function RunningClock({ sinceMs }: { sinceMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - sinceMs) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-amber">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
      采集中 {mm}:{ss}
    </span>
  );
}

function PrimaryButton({
  row,
  primary,
  onDone,
}: {
  row: ChannelLedgerRow;
  primary: LedgerPrimaryAction;
  onDone: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (primary.type === "running") return <RunningClock sinceMs={primary.sinceMs} />;
  const disabled = busy || !row.enabled;
  async function run(): Promise<void> {
    setBusy(true);
    try {
      switch (primary.type) {
        case "crawl": {
          const body = await post(`/api/channels/${primary.channelId}/crawl`);
          onDone(body.code === 0 ? null : body.message);
          break;
        }
        case "crawlBloggers": {
          onDone(await postEach(primary.bloggerIds, (id) => `/api/bloggers/${id}/crawl`));
          break;
        }
        case "hotboard": {
          const body = await post("/api/insight/trigger", { job: "hotboard" });
          onDone(body.code === 0 ? null : body.message);
          break;
        }
        case "discover": {
          const body = await post("/api/discovery/trigger", { job: primary.job });
          onDone(body.code === 0 ? null : body.message);
          break;
        }
        case "syncGithub": {
          onDone(await postEach(primary.repoIds, (id) => `/api/github/repos/${id}/sync`));
          break;
        }
      }
    } catch {
      onDone("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }
  const label =
    primary.type === "crawl" || primary.type === "crawlBloggers"
      ? "立即采集"
      : primary.type === "hotboard"
        ? "拉取热榜"
        : primary.type === "discover"
          ? "立即发现"
          : "立即同步";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void run()}
      className="cursor-pointer rounded-sm px-2 py-1 text-xs text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? "入队中…" : label}
    </button>
  );
}

function SecondaryAction({ row }: { row: ChannelLedgerRow }) {
  const [busy, setBusy] = useState(false);
  const s = row.secondary;
  if (s === null) return null;
  if (s.type === "link") {
    return (
      <a href={s.href} className="rounded-sm px-2 py-1 text-xs text-text-2 hover:bg-panel-2">
        {s.label}
      </a>
    );
  }
  const { channelId, label } = s;
  async function debug(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/debug`, { method: "POST" });
      const body = (await res.json()) as ApiEnvelope<ChannelDebugResult>;
      if (body.code !== 0 || !body.data) {
        alert(`试拉失败:${body.message || `HTTP ${res.status}`}`);
        return;
      }
      const { ok, elapsedMs, items, error } = body.data;
      alert(
        [
          `「${row.remark ?? row.name}」${label}${ok ? "成功" : "失败"} · 耗时 ${elapsedMs}ms`,
          ...items.map((i, idx) => `${idx + 1}. ${i.title}`),
          ...(error ? [`错误:${error}`] : []),
        ].join("\n"),
      );
    } catch {
      alert("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void debug()}
      className="cursor-pointer rounded-sm px-2 py-1 text-xs text-text-2 hover:bg-panel-2 disabled:opacity-50"
    >
      {s.label}
    </button>
  );
}

export default function ChannelLedgerRowView({ row }: { row: ChannelLedgerRow }) {
  const router = useRouter();
  const ec = row.editChannel;
  // 人话标签:registry 行备注即注册表 label(vendor:anthropic → Anthropic 官方动态)
  const label = row.remark ?? row.name;

  /** 删除文字渠道(2026-10-24 验收):确认后 DELETE,级联清条目;失败弹人话 */
  async function removeChannel(id: number): Promise<void> {
    if (
      !window.confirm(`删除渠道「${label}」?该渠道已采集的全部条目将一并删除,不可恢复。确认删除?`)
    )
      return;
    try {
      const res = await fetch(`/api/channels/${id}`, { method: "DELETE" });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        alert(`删除失败:${body.message || `HTTP ${res.status}`}`);
        return;
      }
      router.refresh();
    } catch {
      alert("网络错误,请重试");
    }
  }

  return (
    <tr
      className={`border-b border-line last:border-b-0 hover:bg-panel-2 ${
        row.enabled ? "" : "opacity-60"
      }`}
    >
      <td className="px-4 py-2.5">
        <div className="font-medium text-text-1">{row.name}</div>
        {ec !== null && (
          <div className="mt-1 flex items-center gap-1.5">
            <ChannelDialog
              label="编辑"
              channel={ec}
              buttonClass="cursor-pointer rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-2 hover:border-accent hover:text-accent"
            />
            <button
              type="button"
              onClick={() => void removeChannel(ec.id)}
              className="cursor-pointer rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-2 hover:border-red hover:text-red"
            >
              删除
            </button>
            {row.snapshotsHref !== null && (
              <a
                href={row.snapshotsHref}
                className="rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-2 hover:border-accent hover:text-accent"
                title="取数原文与整页截图(解析前落盘)"
              >
                快照
              </a>
            )}
          </div>
        )}
      </td>
      <td className="max-w-[240px] px-3 py-2.5">
        {row.remark === null || row.remark === "" ? (
          <span className="text-xs text-text-3">—</span>
        ) : (
          <span className="block truncate text-xs text-text-2" title={row.remark}>
            {row.remark}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {row.statusEndpoint !== null && (
            <StatusSwitch
              endpoint={row.statusEndpoint}
              enabled={row.enabled}
              name={label}
              disableHint={`确认停用「${label}」?停用后调度器不再派发任务。`}
            />
          )}
          <span className="text-xs text-text-2">{row.cadence}</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className={`inline-flex items-center gap-1.5 text-xs ${HEALTH_TEXT[row.health]}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${HEALTH_STYLE[row.health]}`} />
          {row.healthText}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-text-2">
        {row.lastRunLabel}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <div className="flex items-center justify-end gap-1">
          <PrimaryButton
            row={row}
            primary={row.primary}
            onDone={(msg) => {
              if (msg !== null) alert(`触发失败:${msg}`);
              else router.refresh();
            }}
          />
          <SecondaryAction row={row} />
        </div>
      </td>
    </tr>
  );
}
