/**
 * 站务通知内容(M66):转人工卡片 + 测试卡片。
 *
 * 纪律:通知是旁路——配置缺失/关闭/上游失败都只记日志,绝不影响公众号回执
 * (用户 5s 内必须拿到回复)。
 */
import { formatCnDateTime } from "@/lib/datetime";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

import { sendFeishuChatMessage, type FeishuSendResult } from "./client";
import { getFeishuAlertRuntimeConfig } from "./config";

/** openid 脱敏(后台通知里够定位,不整串外泄) */
function shortOpenid(openid: string): string {
  if (openid.length <= 12) return openid;
  return `${openid.slice(0, 6)}…${openid.slice(-4)}`;
}

/** 后台会话详情链(按 channel_wechat_mp_user.id,与 /admin/wechat-mp/[id] 同位) */
function adminSessionUrl(sessionId: string): string {
  return new URL(`/admin/wechat-mp/${sessionId}/`, env.NEXT_PUBLIC_SITE_URL).toString();
}

/** 卡片 JSON(飞书 interactive;action 按钮跳后台会话详情) */
function buildCard(card: {
  title: string;
  template: "orange" | "blue" | "green";
  lines: string[];
  url?: string;
  buttonText?: string;
}): string {
  const elements: unknown[] = [
    { tag: "div", text: { tag: "lark_md", content: card.lines.join("\n") } },
  ];
  if (card.url) {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          text: { tag: "plain_text", content: card.buttonText ?? "打开后台会话" },
          type: "primary",
          url: card.url,
        },
      ],
    });
  }
  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: card.title }, template: card.template },
    elements,
  });
}

/** 转人工通知(飞书群卡片);返回 null = 未启用/未配置(静默跳过) */
export async function notifyHandoffLead(params: {
  openid: string;
  userId: bigint | null;
  reason: string;
  content: string;
  /** channel_wechat_mp_user.id(会话详情路由键,不是消息 id) */
  sessionId: string;
}): Promise<FeishuSendResult | null> {
  const cfg = await getFeishuAlertRuntimeConfig();
  if (!cfg || !cfg.enabled || !cfg.isNotifyHandoff) return null;
  const card = buildCard({
    title: "公众号转人工",
    template: "orange",
    lines: [
      `**用户**:${shortOpenid(params.openid)}${params.userId ? `(站内已绑定)` : "(未绑定)"}`,
      `**触发**:${params.reason}`,
      `**问题**:${params.content.slice(0, 200)}`,
      `**时间**:${formatCnDateTime(new Date())}`,
    ],
    url: adminSessionUrl(params.sessionId),
  });
  const r = await sendFeishuChatMessage(cfg, "interactive", card);
  if (!r.ok) {
    logger.warn({ event: "wechat_mp.handoff_notify_failed", error: r.error });
  }
  return r;
}

/** 后台「发送测试卡片」:验证 app_id/secret/chat_id 三者可用 */
export async function sendAlertTestCard(): Promise<FeishuSendResult> {
  const cfg = await getFeishuAlertRuntimeConfig();
  if (!cfg) {
    return {
      ok: false,
      error: "请先保存 App ID、App Secret 与群 chat_id",
      latencyMs: 0,
      messageId: null,
    };
  }
  const card = buildCard({
    title: "站务通知测试",
    template: "blue",
    lines: [
      "这是一条来自一起AI后台的测试卡片。",
      `**发送时间**:${formatCnDateTime(new Date())}`,
      "收到即代表公众号转人工通知通道可用。",
    ],
    url: new URL("/admin/wechat-mp/", env.NEXT_PUBLIC_SITE_URL).toString(),
    buttonText: "打开公众号会话",
  });
  return sendFeishuChatMessage(cfg, "interactive", card);
}
