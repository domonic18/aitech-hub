/**
 * 数据中心壳层(2026-10-18 数据壳重组·方案二:采集/洞察/发现三中心并为一体化
 * 管理):源管理/运行/洞察/挖掘四页签经 AdminTabNav 子段路由切换,页内二级视图
 * 走 ?t= 参数。旧路径 /admin/spider|insight|discovery 经 next.config 308 承接。
 */
import AdminTabNav from "@/components/admin/AdminTabNav";

export default function AdminDataLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <AdminTabNav
        items={[
          { label: "源管理", href: "/admin/data/sources/" },
          { label: "运行", href: "/admin/data/run/" },
          { label: "洞察", href: "/admin/data/insight/" },
          { label: "挖掘", href: "/admin/data/mine/" },
        ]}
      />
      {children}
    </div>
  );
}
