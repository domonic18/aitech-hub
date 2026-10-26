"use client";

/**
 * 生成中进度卡(M44 原型 F5):舞台在途态的替代渲染——头部(脉冲圆点 +
 * 「AI 助手执行中」chip)+ 四步清单(前两步为静态示意:agent 固定先读素材
 * 与配置,真实过程看助手对话)+ indeterminate 进度条 + 骨架瓦片。诚实呈现
 * 阶段,不伪造逐张进度(agent run 内部无页面可见信号)。
 */
import type { GenerationKind } from "@/lib/topics/generation-state";

export default function GenerationProgressCard({
  kind,
  pinTarget,
}: {
  kind: GenerationKind;
  /** 贴图目标张数(来自贴图配置,骨架瓦片数量上限) */
  pinTarget?: number;
}) {
  const isPin = kind === "pin";
  const label = isPin ? "贴图" : "长文";
  const steps: [boolean | "active", string][] = [
    [true, isPin ? "已读取素材与参照图" : "已读取素材与写作要求"],
    [true, isPin ? "已应用贴图配置" : "已应用写作要求"],
    ["active", isPin ? `正在生成 ${pinTarget ?? "n"} 张图片…` : "正在撰写初稿…"],
    [false, isPin ? "落库并刷新舞台" : "落库并刷新舞台"],
  ];
  const tiles = Math.min(Math.max(pinTarget ?? 3, 3), 6);

  return (
    <div className="flex flex-col gap-4 rounded-sm border border-line bg-panel p-5">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        <span className="text-[13px] font-semibold text-text-1">正在生成{label}</span>
        <span className="ml-auto rounded-sm bg-accent/12 px-2 py-0.5 text-[11px] text-accent">
          AI 助手执行中
        </span>
      </div>

      <ol className="flex flex-col gap-2">
        {steps.map(([state, text]) => (
          <li key={text} className="flex items-center gap-2 text-[12px]">
            {state === true ? (
              <span className="text-green">✓</span>
            ) : state === "active" ? (
              <span className="text-accent">●</span>
            ) : (
              <span className="text-text-3">○</span>
            )}
            <span
              className={
                state === "active" ? "text-text-1" : state === true ? "text-text-2" : "text-text-3"
              }
            >
              {text}
            </span>
          </li>
        ))}
      </ol>

      {/* indeterminate 进度条:脉冲高亮段从左向右扫 */}
      <div className="h-1 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: tiles }, (_, i) => (
          <div
            key={i}
            className="flex aspect-[3/4] animate-pulse items-center justify-center rounded-sm border border-line bg-panel-2 text-[11px] text-text-3"
          >
            {i === 0 ? "生成中" : "排队中"}
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        任务已交给右侧 AI
        助手执行,可离开本页;完成后舞台会自动刷新并高亮新产出,执行过程可在右侧对话查看。
      </p>
    </div>
  );
}
