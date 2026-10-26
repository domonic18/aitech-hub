/**
 * AI 用量壳层(侧栏精简批②):用量/会话两页合并为侧栏入口「AI 用量」,
 * 页签经 AdminTabNav 子段路由切换;守卫与取数仍在各子页。旧路径
 * /admin/agent-sessions 经 next.config 308 承接。
 */
import AdminTabNav from "@/components/admin/AdminTabNav";

export default function AdminUsageLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <AdminTabNav
        items={[
          { label: "用量", href: "/admin/usage/" },
          { label: "会话", href: "/admin/usage/sessions/" },
        ]}
      />
      {children}
    </div>
  );
}
