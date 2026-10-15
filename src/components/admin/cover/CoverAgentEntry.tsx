"use client";

/**
 * AI 生成封面入口块(M31 验收反馈 agent 化):弹窗内不再直连生图,唤起编辑页
 * 侧边栏 Agent——ask_user 对齐方向 → 生成候选 → 预览卡确认后才入库。
 */
export default function CoverAgentEntry({
  onLaunch,
}: {
  onLaunch: () => void;
}): React.ReactElement {
  return (
    <>
      <div className="text-[11px] font-medium text-text-2">
        AI 生成封面 <span className="ml-1 font-normal text-text-3">(侧边栏 Agent)</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-text-3">
        Agent 先读文章内容并与你确认提示词方向,生成候选后在侧边栏预览,确认后才会入库
      </p>
      <button
        type="button"
        onClick={onLaunch}
        className="mt-1.5 flex-none cursor-pointer rounded-sm border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent-dim"
      >
        唤起 Agent 生成候选
      </button>
    </>
  );
}
