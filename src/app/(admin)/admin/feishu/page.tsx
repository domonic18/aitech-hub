/**
 * 飞书免登配置页(M29 批①,侧栏「系统」组,形态随 /admin/email):飞书自建
 * 应用凭证入库维护(不入 env——与邮件/支付配置同规则)+ 当前账号的飞书身份
 * 绑定区(密码会话内自绑,兑换通道白名单本体)。凭证齐即可绑定/签名;
 * 「启用」单独控制免登兑换。
 */
import FeishuConfigForm from "@/components/admin/FeishuConfigForm";
import { getBindingForUser } from "@/lib/auth/feishu-binding";
import { getFeishuConfigAdmin } from "@/lib/auth/feishu-config";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function AdminFeishuPage(): Promise<React.ReactElement> {
  const claims = await requireAdminPage();
  const [config, binding] = await Promise.all([
    getFeishuConfigAdmin(),
    getBindingForUser(BigInt(claims.sub)),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">飞书免登</h2>
        <p className="mt-0.5 text-xs text-text-3">
          飞书工作台免登进入后台:应用凭证存 admin_feishu_config,绑定关系存
          admin_feishu_binding;保存即时生效,支持就地探测连通。
        </p>
      </div>
      <FeishuConfigForm initialConfig={config} initialBinding={binding} />
    </div>
  );
}
