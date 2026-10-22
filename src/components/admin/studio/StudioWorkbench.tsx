"use client";

/**
 * 创作工作台三栏骨架(v2 交互重构,参照 Figma/剪映类三栏创作台):
 * 左素材栏 264px / 中舞台(页签 长文|贴图 + 产出内容 + 底部吸附创作条)/
 * 右配置栏 312px。页签单点驱动舞台与配置(hidden 切换不卸载,未保存配置
 * 不丢);默认页签随主意图(贴图创作先看贴图),用户可自由切换。
 */
import { useState } from "react";

export type WorkbenchTab = "post" | "pin";

export default function StudioWorkbench({
  defaultTab = "post",
  postCount,
  pinCount,
  rail,
  postStage,
  pinStage,
  writingConfig,
  pinConfig,
  createBar,
}: {
  defaultTab?: WorkbenchTab;
  /** 长文份数(0|1,页签计数) */
  postCount: number;
  /** 贴图张数(页签计数) */
  pinCount: number;
  /** 左栏:素材(含添加素材弹层) */
  rail: React.ReactNode;
  /** 舞台「长文」页签:长文产出卡 */
  postStage: React.ReactNode;
  /** 舞台「贴图」页签:贴图产出网格 */
  pinStage: React.ReactNode;
  /** 配置「长文」页签:写作要求 + 样例图 */
  writingConfig: React.ReactNode;
  /** 配置「贴图」页签:贴图配置 + 参照图 */
  pinConfig: React.ReactNode;
  /** 底部创作条(补充要求 + 生成长文/生成贴图) */
  createBar: React.ReactNode;
}) {
  const [tab, setTab] = useState<WorkbenchTab>(defaultTab);

  const tabs: [WorkbenchTab, string, number][] = [
    ["post", "长文", postCount],
    ["pin", "贴图", pinCount],
  ];

  return (
    <div className="grid items-stretch gap-3 lg:grid-cols-[264px_minmax(0,1fr)_312px]">
      {/* 左:素材栏(整列,与配置栏同高) */}
      <div className="min-w-0">{rail}</div>

      {/* 中:舞台(页签 + 产出 + 吸附创作条) */}
      <div className="flex min-w-0 flex-col">
        <div className="mb-2 flex items-center gap-1.5">
          {tabs.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`cursor-pointer rounded-sm px-3 py-1 text-[13px] font-medium ${
                tab === key
                  ? "bg-accent/12 text-accent"
                  : "border border-line text-text-2 hover:text-text-1"
              }`}
            >
              {label}
              <span className="ml-1 font-mono text-[11px] opacity-80">{count}</span>
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div hidden={tab !== "post"}>{postStage}</div>
          <div hidden={tab !== "pin"}>{pinStage}</div>
        </div>
        <div className="sticky bottom-0 mt-3">{createBar}</div>
      </div>

      {/* 右:配置栏(随舞台页签联动,面板不卸载;随页滚动不吸附——配置面高过视口) */}
      <div className="min-w-0 self-start rounded-sm border border-line bg-panel p-2.5">
        <h2 className="mb-2 px-0.5 text-[13px] font-semibold text-text-1">创作配置</h2>
        <div className="flex flex-col gap-3">
          <div hidden={tab !== "post"}>{writingConfig}</div>
          <div hidden={tab !== "pin"}>{pinConfig}</div>
        </div>
      </div>
    </div>
  );
}
