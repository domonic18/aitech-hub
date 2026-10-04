/**
 * 站点设置页(M10 批②,侧栏「站点设置」):站点级运行参数。
 * 当前:首页电报流 LIVE 带条数(site_config kv,1..50,默认 12)。
 * 保存走 PUT /api/site-config(session 鉴权,PAT 拒绝),成功后 on-demand
 * revalidatePath("/", "layout") 首页立即再生,无需等 600s ISR。
 */
import SiteSettingsForm from "@/components/admin/SiteSettingsForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { getBandItemCount } from "@/lib/config/site-config";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const bandItemCount = await getBandItemCount();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">站点设置</h2>
        <p className="mt-0.5 text-xs text-text-3">
          站点级运行参数;保存即时生效(前台页面按需再生,免等 ISR 周期)。
        </p>
      </div>
      <SiteSettingsForm initialBandItemCount={bandItemCount} />
    </div>
  );
}
