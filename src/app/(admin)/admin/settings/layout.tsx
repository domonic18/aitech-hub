/**
 * 系统设置壳层(侧栏精简批①):常规/邮件/短信/飞书/站务通知/支付/PAT 七页
 * 合并为一个侧栏入口「系统设置」,页签经 AdminTabNav 子段路由切换;守卫与取数仍在
 * 各子页(本层不鉴权,零取数)。旧路径 /admin/email 等经 next.config
 * 308 承接。
 */
import AdminTabNav from "@/components/admin/AdminTabNav";

export default function AdminSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <AdminTabNav
        items={[
          { label: "常规", href: "/admin/settings/" },
          { label: "邮件", href: "/admin/settings/email/" },
          { label: "短信", href: "/admin/settings/sms/" },
          { label: "飞书", href: "/admin/settings/feishu/" },
          // 站务通知(M66):公众号转人工/每日汇总的飞书自建应用通道
          { label: "站务通知", href: "/admin/settings/feishu-alert/" },
          { label: "支付", href: "/admin/settings/pay/" },
          { label: "PAT", href: "/admin/settings/pats/" },
        ]}
      />
      {children}
    </div>
  );
}
