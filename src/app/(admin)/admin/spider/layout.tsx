/**
 * 采集壳层(侧栏精简批①):总览/采集计划/渠道三页合并为侧栏入口「采集总览」,
 * 页签经 AdminTabNav 子段路由切换;守卫与取数仍在各子页。旧路径
 * /admin/channels 经 next.config 308 承接。
 */
import AdminTabNav from "@/components/admin/AdminTabNav";

export default function AdminSpiderLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <AdminTabNav
        items={[
          { label: "总览", href: "/admin/spider/" },
          { label: "采集计划", href: "/admin/spider/schedule/" },
          { label: "渠道", href: "/admin/spider/channels/" },
        ]}
      />
      {children}
    </div>
  );
}
