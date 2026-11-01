/**
 * 公众号会话壳层(M66):会话 / 关键词 / 接入配置 三页合并为一个侧栏入口
 * 「公众号会话」,页签经 AdminTabNav 子段路由切换;守卫与取数仍在各子页
 * (本层不鉴权,零取数)。
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
          { label: "接入配置", href: "/admin/wechat-mp/config/" },
        ]}
      />
      {children}
    </div>
  );
}
