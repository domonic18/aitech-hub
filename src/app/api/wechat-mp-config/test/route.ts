/**
 * 公众号入站配置自检(M66):本地「试签 + 加解密回环」。
 *
 * 能验的:Token 形态、EncodingAESKey 能否解码成 32B、AES 往返与 appid 绑定。
 * 验不到的:公众号后台是否已把同一套 Token/AESKey 填到我们的回调 URL 上——
 * 那一步只能由微信服务器访问 `/api/wechat/mp` 完成,页面提示里写清楚。
 * 结果写 channel_wechat_mp_config 的 last_test_* 三列。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { decryptMessage, encryptMessage, computeSignature } from "@/lib/channel/wechat-mp/crypto";
import { getWechatMpRuntimeConfig, recordWechatMpTest } from "@/lib/channel/wechat-mp/config";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const PROBE = "<xml><Content>aitech-hub-wechat-mp-probe</Content></xml>";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const cfg = await getWechatMpRuntimeConfig();
  if (!cfg) {
    return apiEnvelope(400, "请先保存 Token、EncodingAESKey,并在「公众号分发」配置 AppID");
  }

  const startedAt = Date.now();
  try {
    // 1) Token 可用于签名(空结果说明 Token 未落库)
    const signature = computeSignature(cfg.token, "1700000000", "probe");
    if (!/^[0-9a-f]{40}$/.test(signature)) throw new Error("Token 签名计算异常");
    // 2) AESKey 可解码 + 往返一致(appid 不符会在此抛)
    const encrypted = encryptMessage({
      encodingAESKey: cfg.encodingAESKey,
      appId: cfg.appId,
      plaintext: PROBE,
    });
    const decrypted = decryptMessage({
      encodingAESKey: cfg.encodingAESKey,
      encrypt: encrypted,
      appId: cfg.appId,
    });
    if (decrypted !== PROBE) throw new Error("加解密回环不一致,请核对 EncodingAESKey");

    const latencyMs = Date.now() - startedAt;
    await recordWechatMpTest({ ok: true, error: null, latencyMs });
    logger.info({ event: "admin.wechat_mp_config.test_ok", latencyMs });
    return apiEnvelope(
      0,
      "本地试签与加解密回环通过;请到公众号后台用同一套 Token / EncodingAESKey 提交回调 URL 完成校验",
      { latencyMs },
    );
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const error = e instanceof Error ? e.message : String(e);
    await recordWechatMpTest({ ok: false, error, latencyMs }).catch(() => undefined);
    logger.error({ event: "admin.wechat_mp_config.test_failed", error, latencyMs });
    return apiEnvelope(502, `自检失败:${error}`);
  }
}
