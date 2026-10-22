"use client";

/**
 * 创作配置页签(M42 批④):长文配置 / 贴图配置两套独立列的切换壳。
 * 两个面板都来自服务端组件(以 children 传入),此处只持页签态——切换用
 * hidden 而非卸载,避免已写未保存的内容在切页签时丢失。默认页签由主意图
 * 决定(贴图创作先看贴图配置),用户仍可自由切换(产出区恒有两个动作)。
 */
import { useState } from "react";

export default function StudioConfigTabs({
  defaultTab = "writing",
  writing,
  pin,
}: {
  defaultTab?: "writing" | "pin";
  writing: React.ReactNode;
  pin: React.ReactNode;
}) {
  const [tab, setTab] = useState<"writing" | "pin">(defaultTab);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ["writing", "长文配置"],
            ["pin", "贴图配置"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`cursor-pointer rounded-sm px-2.5 py-1 text-xs font-medium ${
              tab === key
                ? "bg-accent/12 text-accent"
                : "border border-line text-text-2 hover:text-text-1"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div hidden={tab !== "writing"}>{writing}</div>
      <div hidden={tab !== "pin"}>{pin}</div>
    </div>
  );
}
