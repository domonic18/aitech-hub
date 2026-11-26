/**
 * /pricing/ 视图共享片段(M55 批E 自 PricingView 拆分):分组口径/官方链接/
 * 日期解析。纯展示、无状态——可被 client 组件直接引用(不进服务端 API)。
 */
import type { PublicModelRow } from "@/lib/pricing/public";
import {
  PROTOCOL_CHIP_LABELS,
  PROTOCOL_COLORS,
  PROTOCOL_LABELS,
  type ApiProtocol,
} from "@/lib/pricing/protocols";

export const REGION_TITLES: Record<string, string> = { cn: "国内厂商", intl: "国际厂商" };
export const CURRENCY_UNITS: Record<string, string> = {
  CNY: "人民币 ¥ / 百万 tokens",
  USD: "美元 $ / 百万 tokens(原币直出)",
};

/** 分组键 = region×currency(组头币种口径必须与组内行一致,不说谎):
 * 终审后的常态数据收敛为 国内·¥ / 国际·$ 两组(同 P1 定稿);若上架异币种
 * 行(如国际厂商 CNY 报价),独立成组如实标注,不混组误导 */
export function groupKey(r: PublicModelRow): string {
  return `${r.region}|${r.currency}`;
}

export function groupTitle(key: string, rows: PublicModelRow[]): string {
  const [region] = key.split("|");
  return `${REGION_TITLES[region ?? ""] ?? region} · ${CURRENCY_UNITS[rows[0]!.currency ?? ""] ?? rows[0]!.currency}`;
}

/** YYYY-MM-DD → 北京日界 Date(与写入侧 formatCnDate 口径对齐) */
export function asOfDate(s: string): Date {
  return new Date(`${s}T00:00:00+08:00`);
}

/** 套餐行标识(vendor×planName 与写入侧三规则的匹配键同构,库里唯一) */
export function planKey(r: { vendor: string; planName: string }): string {
  return `${r.vendor}|${r.planName}`;
}

/** chip 样式(筛选条与更多筛选共用,保证两处观感一致) */
export const CHIP_BASE =
  "rounded-full border px-2.5 py-1 text-[11.5px] leading-none transition-colors cursor-pointer select-none";
export const CHIP_ON = "border-accent bg-accent text-white";
export const CHIP_OFF =
  "border-line bg-panel text-text-2 hover:border-line-hover hover:text-text-1";

export function OfficialLink({ url }: { url: string }): React.ReactElement {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[12px] text-blue hover:text-blue/80"
    >
      官方
    </a>
  );
}

/** 协议 badge(OpenAI/Anthropic 兼容):带品牌色区分,悬停显示完整标签 */
export function ProtocolBadge({ protocol }: { protocol: ApiProtocol }): React.ReactElement {
  const colors = PROTOCOL_COLORS[protocol];
  return (
    <span
      key={protocol}
      title={PROTOCOL_LABELS[protocol]}
      className={`whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[10px] leading-none transition-colors ${colors.border} ${colors.bg} ${colors.text} ${colors.hoverBorder}`}
    >
      {PROTOCOL_CHIP_LABELS[protocol]}
    </span>
  );
}

/** 协议 badge 组(未标注的行走空,不留空位) */
export function ProtocolBadges({
  protocols,
}: {
  protocols: readonly ApiProtocol[];
}): React.ReactElement | null {
  if (protocols.length === 0) return null;
  return (
    <>
      {protocols.map((p) => (
        <ProtocolBadge key={p} protocol={p} />
      ))}
    </>
  );
}
