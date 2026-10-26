/**
 * 公众号草稿提交统一口(M48 批D-2 自 wechat-sync-run/pin-wechat-sync 双管线
 * 收口:同一段 41039 逻辑两处逐行复制,修 bug 不会双达):draft/add(首推)|
 * draft/update(重推,行 mediaId 锚定)分流 + content_source_url 41039 降级
 * 重试一次——微信对该字段有域名校验(localhost/站点 URL 配置失误必触发),
 * 字段可选,被拒时去掉重试:草稿可发优先于「阅读原文」导流。
 * 独立模块而非并入 wechat-sync/wechat-client:两管线单测都在 wechat-client
 * 边界 mock(且 pin 测试整仓 mock wechat-sync),helper 须以真身运行才能被
 * 边界 mock 驱动出重试路径。
 */
import { logger } from "../logger";
import {
  wechatDraftAdd,
  wechatDraftUpdate,
  WechatApiError,
  type WechatCredentials,
  type WechatDraftPayload,
} from "./wechat-client";

export async function submitWechatDraft(
  creds: WechatCredentials,
  article: WechatDraftPayload,
  updateMediaId: string | null,
  event = "wechat.source_url_dropped",
): Promise<string> {
  try {
    if (updateMediaId) {
      await wechatDraftUpdate(creds, updateMediaId, article);
      return updateMediaId;
    }
    return await wechatDraftAdd(creds, article);
  } catch (e) {
    if (!(e instanceof WechatApiError) || e.errcode !== 41039) throw e;
    logger.warn({ event, errcode: e.errcode });
    const { content_source_url: _dropped, ...withoutSourceUrl } = article;
    if (updateMediaId) {
      await wechatDraftUpdate(creds, updateMediaId, withoutSourceUrl);
      return updateMediaId;
    }
    return await wechatDraftAdd(creds, withoutSourceUrl);
  }
}
