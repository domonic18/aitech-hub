/**
 * 源↔行解析(M79,系统修):牌价「采集源」与「产出行」的对应关系,单一出处。
 *
 * 为什么要有:此前按 vendor + 产出面精确匹配,聚合源(百度词元所)一行多 vendor
 * (「词元所·可灵 AI」等按供应方拆行)永远连不上自己的源——源健康计数漏算、
 * 终审闸门整批误拒、按源下架圈不到行。M74 归一层早已给每行落了稳定厂商键
 * (provider_id → provider.key,采集器的 providerKey 落库),它才是正确的主键:
 * **providerKey + 产出面**优先,vendor 精确匹配兜底(未归一的过渡期行/后台手建行)。
 *
 * 三个消费方共用本模块,口径永不分叉:
 * - health.ts(源健康与产出分布计数)
 * - review-gate.ts(终审闸门的「源不健康拒」)
 * - offline-source.ts(按源下架圈行)
 *
 * 新增数据源的扩展点:source-registry 的 def 声明 providerKey(与采集器落行的
 * providerKey 同一空间,PROVIDER_SEEDS 里登记),行侧零改动即自动对齐。
 */

/** 解析用源形状(health 读侧的 SourceHealth / 注册表 def 都满足) */
export interface ResolvableSource {
  /** 源 key(计数归桶用) */
  key: string;
  vendor: string;
  target: "model" | "plan";
  /** 厂商归一键(PROVIDER_SEEDS 空间;空串视为无,走 vendor 兜底) */
  providerKey: string;
}

/** 解析用行形状(调用方从 model_pricing / coding_plan 查出后裁字段) */
export interface ResolvableRow {
  vendor: string;
  /** 产出面;缺省按模型表(review/list 工具只碰模型表,同旧口径) */
  target?: "model" | "plan";
  /** 行的厂商归一键(provider 字典 join;null=未归一,走 vendor 兜底) */
  providerKey?: string | null;
}

const rowTarget = (r: ResolvableRow): "model" | "plan" => r.target ?? "model";

/**
 * 构建行→源解析器(纯函数,单测锚)。
 * 解析顺序:providerKey + 产出面 → vendor + 产出面(逐字相等)。
 * 两级都 miss → undefined(调用方如实处理:闸门拒、计数不计、下架圈不到)。
 */
export function buildPricingSourceResolver<S extends ResolvableSource>(
  sources: readonly S[],
): (row: ResolvableRow) => S | undefined {
  const byProvider = new Map<string, S>();
  const byVendor = new Map<string, S>();
  for (const s of sources) {
    if (s.providerKey !== "") {
      byProvider.set(`${s.providerKey}|${s.target}`, s);
    }
    byVendor.set(`${s.vendor}|${s.target}`, s);
  }
  return (row) => {
    const target = rowTarget(row);
    if (row.providerKey !== null && row.providerKey !== undefined && row.providerKey !== "") {
      const hit = byProvider.get(`${row.providerKey}|${target}`);
      if (hit !== undefined) return hit;
    }
    return byVendor.get(`${row.vendor}|${target}`);
  };
}
