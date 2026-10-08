/**
 * AI 连通性测试状态徽章(批D 收敛:ModelTable 与 AsrCard 同形三态):
 * ok → 绿色 ✓ 延迟(title 悬浮毫秒);fail → 红色 ✗ 失败(title 悬浮错误);
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
    return (
      <span className="cursor-help text-red" title={error ?? undefined}>
        ✗ 失败
      </span>
    );
  }
  return <span className="text-text-3">未测试</span>;
}
