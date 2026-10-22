"use client";

/**
 * 舞台状态门(M44 状态驱动交互):按生成态接管对应页签的舞台渲染——
 * 在途 = 进度卡整体替代(原型 F5);刚完成 = 顶部绿色横幅 + 产出内容
 * (原型 F6,横幅可关闭,× 后本轮「新」徽标一并消失);空闲 = 原样透传。
 * post/pin 两页签各自独立 gating,互不影响。
 */
import GenerationProgressCard from "./GenerationProgressCard";
import { useStudioGeneration } from "./StudioGenerationProvider";
import type { GenerationKind } from "@/lib/topics/generation-state";

export default function StageStateGate({
  kind,
  pinTarget,
  children,
}: {
  kind: GenerationKind;
  /** 贴图目标张数(进度卡骨架用,仅 kind=pin 需要) */
  pinTarget?: number;
  children: React.ReactNode;
}) {
  const { generating, completed, dismissCompleted } = useStudioGeneration();

  if (generating === kind) return <GenerationProgressCard kind={kind} pinTarget={pinTarget} />;

  const banner =
    completed?.kind === kind ? (
      <div className="flex items-start gap-2 rounded-sm border border-green/40 bg-green/10 px-3 py-2">
        <span className="text-green">✓</span>
        <div className="flex-1 text-[12px] leading-relaxed text-text-1">
          {kind === "post" ? (
            <>
              长文初稿已生成,舞台已刷新——点下方「打开文档」人工定稿,或继续调整写作要求后重新生成。
            </>
          ) : (
            <>
              本轮贴图已生成 {completed.newIds.length} 张并入——悬停卡片可去组装台精修或前台预览,
              满意后点右上角「标记为已发布」。
            </>
          )}
        </div>
        <button
          type="button"
          onClick={dismissCompleted}
          aria-label="关闭完成提示"
          className="cursor-pointer text-text-3 hover:text-text-1"
        >
          ×
        </button>
      </div>
    ) : null;

  if (!banner) return <>{children}</>;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {banner}
      {children}
    </div>
  );
}
