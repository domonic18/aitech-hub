/**
 * 公众号会话壳层(M66):会话 / 关键词两页合并为一个侧栏入口「公众号会话」,
 * 页签经 AdminTabNav 子段路由切换;守卫与取数仍在各子页(本层不鉴权,零取数)。
 * 接入配置属配置类页面,收口在「系统设置 → 公众号」(/admin/settings/wechat-mp/)。
 */
import AdminTabNav from "@/components/admin/AdminTabNav";

export default function AdminWechatMpLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <AdminTabNav
        items={[
          { label: "会话", href: "/admin/wechat-mp/" },
          { label: "关键词", href: "/admin/wechat-mp/keywords/" },
        ]}
      />
      {children}
    </div>
  );
}
