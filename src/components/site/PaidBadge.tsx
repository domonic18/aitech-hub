/**
 * 付费文章标识(M56 review P1-4):列表/卡片两视图共用一枚,防视图漂移
 * (此前卡片视图丢徽章,付费文章在卡片视图不可辨)。
 */
export default function PaidBadge({ className = "" }: { className?: string }): React.ReactElement {
  return (
    <span
      title="付费文章,解锁后阅读全文"
      className={`inline-block rounded-sm border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent ${className}`}
    >
      ¥ 付费
    </span>
  );
}
