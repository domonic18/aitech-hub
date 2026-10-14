/**
 * 发现中心壳层(侧栏精简批②):治理/博主/项目三页合并为侧栏入口「发现中心」,
 * 页签经 AdminTabNav 子段路由切换;守卫与取数仍在各子页。旧路径
 * /admin/bloggers、/admin/github 经 next.config 308 承接。
 */
import AdminTabNav from "@/components/admin/AdminTabNav";

export default function AdminDiscoveryLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <AdminTabNav
        items={[
          { label: "治理", href: "/admin/discovery/" },
          { label: "博主", href: "/admin/discovery/bloggers/" },
          { label: "项目", href: "/admin/discovery/github/" },
        ]}
      />
      {children}
    </div>
  );
}
