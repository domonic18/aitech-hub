/**
 * 数据中心壳层(IA v5 板定:F17/F21/F22 页签序 源管理→计划→运行,数据中心
 * 收敛为纯采集执行域;洞察拆独立域 /admin/insight,挖掘拆入源管理/洞察)。
 * 页内二级视图走 ?t= 参数。旧路径 /admin/spider|insight|discovery|mine 经
 * next.config 308 承接。
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
          { label: "计划", href: "/admin/data/plan/" },
          { label: "运行", href: "/admin/data/run/" },
        ]}
      />
      {children}
    </div>
  );
}
