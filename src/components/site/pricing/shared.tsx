/**
 * /pricing/ 视图共享片段(M55 批E 自 PricingView 拆分):分组口径/官方链接/
 * 日期解析。纯展示、无状态——可被 client 组件直接引用(不进服务端 API)。
 */
import type { PublicModelRow } from "@/lib/pricing/public";

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
