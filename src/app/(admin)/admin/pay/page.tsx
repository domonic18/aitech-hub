/**
 * 支付配置页(M21 批②,侧栏「系统」组;自批⑤ 提前——凭据链路随批② 网关
 * 代码闭环):支付模式(总闸)与网关凭据全部入库维护(2026-10-08/09 拍板,
 * env 无任何支付变量,与邮件配置同规则)。secret 只写不读:掩码回显,修改
 * 需整串重输;模式切换与凭据保存均即时生效。mock 选项仅开发环境渲染。
 */
import PayGatewayConfigForm from "@/components/admin/PayGatewayConfigForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { env } from "@/lib/env";
import { getPayGatewayConfigView } from "@/lib/pay/gateway-config";

export const dynamic = "force-dynamic";

export default async function AdminPayPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const initial = await getPayGatewayConfigView();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">支付配置</h2>
        <p className="mt-0.5 text-xs text-text-3">
          支付收款总闸与网关凭据,均存库维护(与邮件配置同规则);模式切换与凭据保存即时生效。
          {process.env.NODE_ENV === "production"
            ? ""
            : "当前为开发环境,可选「模拟」网关联调全链路。"}
        </p>
      </div>
      <PayGatewayConfigForm initial={initial} allowMock={env.NODE_ENV !== "production"} />
    </div>
  );
}
