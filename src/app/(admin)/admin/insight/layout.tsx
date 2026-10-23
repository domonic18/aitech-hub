/**
 * 洞察中心壳(IA v5 板定:F10/F11 拆出数据壳独立立域 /admin/insight)。
 * 顶部双 chip(分析总览 | 发现)由 client 件按路径点亮,簇详情页自动隐藏。
 */
import InsightTopTabs from "@/components/admin/insight/TopTabs";

export default function AdminInsightLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <InsightTopTabs />
      {children}
    </div>
  );
}
