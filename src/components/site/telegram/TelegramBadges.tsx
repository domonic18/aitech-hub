/**
 * 电报流卡头徽章对(P2-14b 自 技术债评审 收敛:TelegramTimeline 与
 * TelegramArticle 的 NEW / 「AI 解读」徽章 JSX 逐字重复):
 * - NewBadge:绿色 NEW 章;亮起条件 isNew(aiRanAt, now) 留在调用侧——
 *   基准口径(变可见时刻,M15 批①)注释随条件走;
 * - AiBadge:「AI 解读」accent 章(AI 摘要段内联前缀)。
 */
export function NewBadge(): React.ReactElement {
  return (
    <span className="rounded-sm bg-green/10 px-1.5 py-px font-mono text-[10px] text-green-hi">
      NEW
    </span>
  );
}

export function AiBadge(): React.ReactElement {
  return (
    <span className="mr-1.5 inline-block rounded-sm bg-accent-dim px-1.5 py-px align-middle font-mono text-[10px] text-accent">
      AI 解读
    </span>
  );
}
