/**
 * 公众号接入配置(系统设置 → 公众号,M66):服务器配置(Token / EncodingAESKey /
 * 加密方式)与话术、转人工词、每日答案上限。AppID 只读回显——入站与出站分发共用
 * publish_wechat_config 的那一份(公众号后台只有一个 AppID)。
 *
 * 2026-11-01 由 `/admin/wechat-mp/config/` 迁入:配置类页面统一收口到系统设置,
 * 会话/关键词留在「分发 → 公众号会话」;旧路径经 next.config 308 承接。
 */
import WechatMpConfigForm from "@/components/admin/wechat-mp/WechatMpConfigForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { getWechatMpConfigView } from "@/lib/channel/wechat-mp/config";
import { WECHAT_MP_RETENTION_DAYS } from "@/lib/channel/wechat-mp/constants";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AdminWechatMpSettingsPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const view = await getWechatMpConfigView();
  // 尾斜杠不可省:站点 trailingSlash 开启,/api/wechat/mp 会 308 到带斜杠形态,
  // 而微信服务器不跟随跳转——填错即校验失败。
  const webhookUrl = new URL("/api/wechat/mp/", env.NEXT_PUBLIC_SITE_URL).toString();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">公众号</h2>
        <p className="mt-0.5 text-xs text-text-3">
          公众号后台「设置与开发 → 服务器配置」填下方 URL 与 Token,加密方式建议选「安全模式」并填
          EncodingAESKey;保存后点「本地自检」确认加解密链路可用。会话与关键词管理在「分发 →
          公众号会话」。
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
