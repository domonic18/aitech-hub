"use client";

/**
 * 微信公众号渠道卡(F16 板渠道行①):head(图形 + 名称 + 连接 chip)+
 * 最近同步 / 失败·累计 / 自动同步三行 meta + 「配置」「查看记录」文本钮。
 * 配置详情与测试连接收进配置弹层(WechatConfigDialog,F9);「查看记录」
 * 平滑滚动定位到记录卡(#distribute-records)。
 */
import { useState } from "react";

import type { DistributeOverview } from "@/lib/distribute/records";
import type { WechatConfigView } from "@/lib/distribute/wechat-config-admin";
import { formatCnRelative } from "@/lib/datetime";
import WechatConfigDialog from "./WechatConfigDialog";

const ACTION_BTN =
  "cursor-pointer rounded-sm px-1 py-0.5 text-[11px] text-accent hover:bg-accent-dim";

export default function WechatConfigCard({
  config,
  overview,
}: {
  config: WechatConfigView;
  overview: DistributeOverview;
}) {
  const [open, setOpen] = useState(false);

  const last = overview.lastRecord;
  const lastLine = last
    ? {
        time: formatCnRelative(new Date(last.updatedAt)),
        label: last.status === "synced" ? "成功" : last.status === "failed" ? "失败" : "同步中",
        cls: last.status === "synced" ? "text-green" : last.status === "failed" ? "text-red" : "",
      }
    : null;

  function scrollToRecords(): void {
    document
      .getElementById("distribute-records")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex flex-col rounded-md border border-line bg-panel px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg className="ic text-accent" aria-hidden="true">
            <use href="#i-send" />
          </svg>
          <span className="text-[12.5px] font-medium text-text-1">微信公众号</span>
        </div>
        <span
          className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
            config.enabled ? "bg-green/12 text-green" : "bg-panel-2 text-text-3"
          }`}
        >
          {config.enabled ? "已连接" : "未启用"}
        </span>
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-1.5 text-[11.5px] text-text-2">
        <div>
          {lastLine ? (
            <>
              最近同步:{lastLine.time} · <span className={lastLine.cls}>{lastLine.label}</span>
            </>
          ) : (
            "暂无同步"
          )}
        </div>
        <div>
          失败 {overview.failedCount} · 累计 {overview.totalSynced.toLocaleString("en-US")} 篇
        </div>
        <div>自动同步:{config.autoSyncEnabled ? "已开启" : "已关闭"}</div>
      </div>

      <div className="mt-3 flex items-center gap-1">
        <button type="button" className={ACTION_BTN} onClick={() => setOpen(true)}>
          配置
        </button>
        <button type="button" className={ACTION_BTN} onClick={scrollToRecords}>
          查看记录
        </button>
      </div>

      {open && <WechatConfigDialog config={config} onClose={() => setOpen(false)} />}
    </div>
  );
}
