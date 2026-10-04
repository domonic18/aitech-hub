/**
 * 站点设置页(M10 批②,侧栏「站点设置」;M12 批② 键族扩展):站点级运行
 * 参数与站点标识(site_config kv,键族见 site-config.ts)。保存走 PUT
 * /api/site-config(session 鉴权,PAT 拒绝),成功后 on-demand revalidate
 * 首页/feed.xml/llms.txt 立即再生,其余页标题走 ISR 窗口。
 */
import SiteSettingsForm from "@/components/admin/SiteSettingsForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { getSiteSettings } from "@/lib/config/site-config";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const initial = await getSiteSettings();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">站点设置</h2>
        <p className="mt-0.5 text-xs text-text-3">
          站点级运行参数与站点标识;保存即时生效(前台页面按需再生,免等 ISR 周期)。
        </p>
      </div>
      <SiteSettingsForm initial={initial} />
    </div>
  );
}
