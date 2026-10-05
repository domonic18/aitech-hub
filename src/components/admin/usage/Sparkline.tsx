/**
 * 明细行趋势微柱(M14 批⑦,原型 spark):14 桶 tokens,纯 div;空桶画 2px 基线。
 */
export default function Sparkline({ data }: { data: number[] }): React.ReactElement {
  const max = Math.max(...data, 1);
  return (
    <span className="inline-flex items-end gap-[1.5px]" style={{ height: 22 }}>
      {data.map((v, i) => (
        <i
          key={i}
          className="w-[3.5px] rounded-[1px] bg-accent opacity-75"
          style={{ height: Math.max(2, (v / max) * 22) }}
        />
      ))}
    </span>
  );
}
