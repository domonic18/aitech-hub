/**
 * AI 连通性测试状态徽章(批D 收敛:ModelTable 与 AsrCard 同形三态):
 * ok → 绿色 ✓ 延迟(title 悬浮毫秒);fail → 红色 ✗ 失败 + 内联截断原因
 * (M39 验收反馈:仅 title 悬浮易漏看,「失败且没有错误原因」;全文仍悬浮);
 * 其余 → 未测试。数据形状 models / asr_config 两表一致。
 */
export default function TestStatusBadge({
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
    const reason = (error ?? "").replace(/\s+/g, " ").trim();
    return (
      <span className="cursor-help text-red" title={reason || undefined}>
        ✗ 失败
        {reason !== "" && (
          <span className="ml-1 font-normal text-text-3">
            {reason.length > 48 ? `${reason.slice(0, 48)}…` : reason}
          </span>
        )}
      </span>
    );
  }
  return <span className="text-text-3">未测试</span>;
}
