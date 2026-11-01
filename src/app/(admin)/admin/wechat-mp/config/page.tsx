/**
 * 公众号接入配置(M66):服务器配置(Token / EncodingAESKey / 加密方式)与
 * 三档话术、转人工词、每日答案上限。AppID 只读回显——入站与出站分发共用
 * publish_wechat_config 的那一份(公众号后台只有一个 AppID)。
 */
import WechatMpConfigForm from "@/components/admin/wechat-mp/WechatMpConfigForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { getWechatMpConfigView } from "@/lib/channel/wechat-mp/config";
import { WECHAT_MP_RETENTION_DAYS } from "@/lib/channel/wechat-mp/constants";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AdminWechatMpConfigPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const view = await getWechatMpConfigView();
  const webhookUrl = new URL("/api/wechat/mp", env.NEXT_PUBLIC_SITE_URL).toString();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">接入配置</h2>
        <p className="mt-0.5 text-xs text-text-3">
          公众号后台「设置与开发 → 服务器配置」填下方 URL 与 Token,加密方式建议选 「安全模式」并填
          EncodingAESKey;保存后点「本地自检」确认加解密链路可用。
        </p>
      </div>

      <section className="rounded-md border border-line bg-panel px-4 py-3 text-xs">
        <div className="text-[11px] text-text-3">服务器地址(URL)</div>
        <div className="mt-0.5 break-all font-mono text-[13px] text-text-1">{webhookUrl}</div>
        <p className="mt-2 text-[11px] leading-relaxed text-text-3">
          认证订阅号没有客服消息接口权限,只能走 5 秒被动回复:检索 + LLM 生成在 4.2
          秒内完成才直接回答案,超时先回「稍后继续」话术,用户发「继续」再取结果。 消息明细保留{" "}
          {WECHAT_MP_RETENTION_DAYS} 天(渠道用户与线索不动)。
        </p>
      </section>

      <WechatMpConfigForm initial={view} />
    </div>
  );
}
