/**
 * 公众号入站编排(M66):验签 → 解密 → 解析 → 幂等 → 三档回复。
 *
 * 这是整条链路唯一跑在**请求线程**里的部分,必须在 5s 平台窗口内返回 XML:
 * - L0(关注/关键词/继续/人工/绑定码/帮助)同步毫秒级,直接出文本;
 * - L1 只 enqueue 生成 job(worker 干活),请求侧轮询 Redis 结果键 ≤4.2s;
 * - 超时回固定话术,worker 算完仍会写缓存,用户回「继续」即可秒取。
 *
 * 请求内等待是平台硬约束下的**明确例外**(只轮询一个 Redis 键,不承担生成),
 * 登记见 docs/arch/05 §4.10。
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getQueue, QUEUE_WECHAT_MP } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { BLOCKLIST_SCOPE_ALL, BLOCKLIST_SCOPE_WECHAT_MP } from "@/lib/telegram/constants";

import { notifyHandoffLead } from "../feishu/alert";
import {
  buildEncryptedReplyXml,
  buildTextReplyXml,
  computeMsgSignature,
  computeSignature,
  decryptMessage,
  parseEncryptedEnvelope,
  parseInbound,
  safeEqualHex,
  truncateUtf8,
  type InboundMessage,
} from "./crypto";
import { readWechatMpReply, type WechatMpReplyPayload } from "./answer";
import {
  WECHAT_MP_CONTINUE_POLL_BUDGET_MS,
  WECHAT_MP_JOB_ANSWER,
  WECHAT_MP_POLL_INTERVAL_MS,
  WECHAT_MP_REPLY_MAX_BYTES,
  WECHAT_MP_REPLY_TTL_SECONDS,
  WECHAT_MP_WAIT_BUDGET_MS,
  wechatMpAnswerJobId,
  wechatMpKeys,
  type WechatMpAnswerStatus,
  type WechatMpReplyKind,
} from "./constants";
import { getWechatMpRuntimeConfig, type WechatMpRuntimeConfig } from "./config";
import {
  bindChannelUser,
  claimInboundMessage,
  ensureChannelUser,
  findStoredReply,
  saveOutboundMessage,
  updateChannelUser,
} from "./inbound";
import {
  buildKeywordReply,
  isContinueWord,
  isHandoffPhrase,
  isHelpWord,
  isTooLongQuery,
  looksLikeBindCode,
  matchKeyword,
  normalizeInput,
} from "./reply";

export interface WechatMpHttpResult {
  status: number;
  body: string;
  contentType: string;
}

const XML_TYPE = "application/xml; charset=utf-8";

function xml(body: string): WechatMpHttpResult {
  return { status: 200, body, contentType: XML_TYPE };
}

function fail(status: number): WechatMpHttpResult {
  return { status, body: "invalid signature", contentType: "text/plain; charset=utf-8" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 服务器配置校验(GET):验签后原样回显 echostr;安全模式下 echostr 为密文 */
export async function handleWechatMpGet(sp: URLSearchParams): Promise<WechatMpHttpResult> {
  const cfg = await getWechatMpRuntimeConfig();
  if (!cfg)
    return { status: 503, body: "not configured", contentType: "text/plain; charset=utf-8" };

  const timestamp = sp.get("timestamp") ?? "";
  const nonce = sp.get("nonce") ?? "";
  const echostr = sp.get("echostr") ?? "";
  const msgSignature = sp.get("msg_signature");
  const encryptType = sp.get("encrypt_type");

  if (encryptType === "aes" || msgSignature) {
    if (
      !safeEqualHex(computeMsgSignature(cfg.token, timestamp, nonce, echostr), msgSignature ?? "")
    ) {
      return fail(403);
    }
    try {
      const plain = decryptMessage({
        encodingAESKey: cfg.encodingAESKey,
        encrypt: echostr,
        appId: cfg.appId,
      });
      return xml(plain);
    } catch (e) {
      logger.warn({
        event: "wechat_mp.echostr_decrypt_failed",
        error: e instanceof Error ? e.message : String(e),
      });
      return fail(403);
    }
  }

  const signature = sp.get("signature") ?? "";
  if (!safeEqualHex(computeSignature(cfg.token, timestamp, nonce), signature)) return fail(403);
  return xml(echostr);
}

interface InboundDispatch {
  text: string;
  kind: WechatMpReplyKind;
  status?: WechatMpAnswerStatus | null;
}

/** 敏感词拦截(blocklist scope: all / wechat-mp);命中即不生成 */
async function isBlocked(text: string): Promise<boolean> {
  const words = await prisma.blocklist.findMany({
    where: {
      enabled: true,
      scope: { in: [BLOCKLIST_SCOPE_ALL, BLOCKLIST_SCOPE_WECHAT_MP] },
    },
    select: { word: true },
  });
  const lower = text.toLowerCase();
  return words.some((w) => {
    const word = w.word.trim().toLowerCase();
    return word !== "" && lower.includes(word);
  });
}

/** 关键词直答(命中计数 +1;挂载文章取标题/摘要/链接) */
async function keywordReply(text: string): Promise<InboundDispatch | null> {
  const keywords = await prisma.channelWechatMpKeyword.findMany({
    where: { isEnabled: true },
    include: {
      post: { select: { id: true, slug: true, title: true, excerpt: true, status: true } },
    },
  });
  const hit = matchKeyword(text, keywords);
  if (!hit) return null;
  await prisma.channelWechatMpKeyword
    .update({ where: { id: hit.id }, data: { hitCount: { increment: 1 } } })
    .catch(() => undefined);
  const post = hit.post && hit.post.status === "published" ? hit.post : null;
  return {
    text: buildKeywordReply({
      keyword: hit.keyword,
      post,
      replyText: hit.replyText,
      fallbackText: "站内暂时没有找到相关内容,可以直接提问。",
    }),
    kind: "keyword",
    status: "ok",
  };
}

/** 绑定码:Redis 命中即写 `openid ↔ userId`(一对一,先解绑旧 openid) */
async function tryBind(
  text: string,
  openid: string,
  cfg: WechatMpRuntimeConfig,
): Promise<InboundDispatch | null> {
  if (!looksLikeBindCode(text)) return null;
  const code = normalizeInput(text).toUpperCase();
  const key = wechatMpKeys.bind(code);
  const userId = await redis.get(key);
  if (!userId) return null;
  await redis.del(key).catch(() => undefined);
  try {
    await bindChannelUser(openid, BigInt(userId));
    logger.info({ event: "wechat_mp.bound", userId });
    return { text: cfg.texts.bindOk, kind: "bind", status: "ok" };
  } catch (e) {
    logger.warn({
      event: "wechat_mp.bind_failed",
      error: e instanceof Error ? e.message : String(e),
    });
    return { text: cfg.texts.bindFail, kind: "bind", status: "error" };
  }
}

/** 转人工:落线索 + 飞书卡片(旁路,不阻塞回执) */
async function handoff(
  text: string,
  ctx: { channelUserId: bigint; messageId: bigint; openid: string; userId: bigint | null },
  cfg: WechatMpRuntimeConfig,
): Promise<InboundDispatch> {
  const keyword = cfg.handoffKeywords.find((k) => text.toLowerCase().includes(k.toLowerCase()));
  const reason = (keyword ? `触发词「${keyword}」` : "用户请求人工").slice(0, 200);
  try {
    await prisma.channelWechatMpLead.create({
      data: { channelUserId: ctx.channelUserId, messageId: ctx.messageId, reason },
    });
    await prisma.channelWechatMpUser.update({
      where: { id: ctx.channelUserId },
      data: { isManualPending: true },
    });
  } catch (e) {
    logger.warn({
      event: "wechat_mp.lead_create_failed",
      error: e instanceof Error ? e.message : String(e),
    });
  }
  void notifyHandoffLead({
    openid: ctx.openid,
    userId: ctx.userId,
    reason,
    content: text,
    sessionId: ctx.channelUserId.toString(),
  }).catch(() => undefined);
  return { text: cfg.texts.handoff, kind: "handoff", status: "ok" };
}

/** L1:入队 + 轮询结果键(BullMQ jobId 幂等;终态先 remove 再 add) */
async function requestAnswer(
  input: {
    openid: string;
    wechatMsgId: string;
    query: string;
    messageId: bigint;
    receivedAt: number;
  },
  cfg: WechatMpRuntimeConfig,
): Promise<InboundDispatch> {
  const jobId = wechatMpAnswerJobId(input.messageId);
  const queue = getQueue(QUEUE_WECHAT_MP);
  // BullMQ 确定性 jobId 陷阱:同 jobId 旧 job 仍在保留窗口内时 add 会被静默丢弃,
  // 故先查态——在途直接复用;终态先 remove 再入队。
  const existing = await queue.getJob(jobId);
  const state = existing ? await existing.getState() : null;
  const inFlight = state === "waiting" || state === "delayed" || state === "active";
  if (existing && !inFlight) await existing.remove();
  if (!inFlight) {
    await queue.add(
      WECHAT_MP_JOB_ANSWER,
      {
        messageId: input.messageId.toString(),
        openid: input.openid,
        wechatMsgId: input.wechatMsgId,
        query: input.query,
        receivedAt: input.receivedAt,
      },
      { jobId, attempts: 2, backoff: { type: "exponential", delay: 2_000 }, removeOnComplete: 200 },
    );
  }
  // 在途指针:答案大概率赶不上 4.2s 窗口(生成常 3–8s),用户随后发的「继续」
  // 靠它知道等哪一条,而不是误回「暂时没有待继续的答复」。
  await redis
    .set(wechatMpKeys.active(input.openid), input.wechatMsgId, "EX", WECHAT_MP_REPLY_TTL_SECONDS)
    .catch(() => undefined);

  const deadline = Date.now() + WECHAT_MP_WAIT_BUDGET_MS;
  for (;;) {
    const hit = await readWechatMpReply(input.wechatMsgId);
    if (hit) return { text: hit.text, kind: hit.kind, status: hit.status };
    if (Date.now() + WECHAT_MP_POLL_INTERVAL_MS > deadline) break;
    await sleep(WECHAT_MP_POLL_INTERVAL_MS);
  }
  return { text: cfg.texts.timeout, kind: "timeout", status: null };
}

/** 「继续」:回捞 Redis 缓存;答案仍在生成则短轮询,彻底没有才回空提示 */
async function continueReply(openid: string, cfg: WechatMpRuntimeConfig): Promise<InboundDispatch> {
  const [pending, active] = await Promise.all([
    redis.get(wechatMpKeys.pending(openid)),
    redis.get(wechatMpKeys.active(openid)),
  ]);
  const target = pending ?? active;
  if (!target) return { text: cfg.texts.continueEmpty, kind: "continue", status: null };

  let cached: WechatMpReplyPayload | null = await readWechatMpReply(target);
  // 在途答案(target 只有 active 指针):用户常在超时回执后几秒内就发「继续」,
  // 此刻多半还没算完——短轮询把「再发一次」变成「直接拿到答案」。
  if (!cached && target === active) {
    const deadline = Date.now() + WECHAT_MP_CONTINUE_POLL_BUDGET_MS;
    while (!cached && Date.now() + WECHAT_MP_POLL_INTERVAL_MS <= deadline) {
      await sleep(WECHAT_MP_POLL_INTERVAL_MS);
      cached = await readWechatMpReply(target);
    }
  }
  if (!cached) return { text: cfg.texts.continuePending, kind: "continue", status: null };
  await Promise.all([
    redis.del(wechatMpKeys.pending(openid)).catch(() => undefined),
    redis.del(wechatMpKeys.active(openid)).catch(() => undefined),
  ]);
  return { text: cached.text, kind: "continue", status: cached.status };
}

/** 刷新渠道用户关注状态 */
async function syncSubscribeState(openid: string, inbound: InboundMessage): Promise<void> {
  const now = new Date();
  if (inbound.event === "subscribe") {
    await updateChannelUser(openid, {
      isSubscribed: true,
      subscribedAt: now,
      unsubscribedAt: null,
    });
  } else if (inbound.event === "unsubscribe") {
    await updateChannelUser(openid, {
      isSubscribed: false,
      unsubscribedAt: now,
    });
  }
}

async function dispatch(
  inbound: InboundMessage,
  ctx: {
    messageId: bigint;
    channelUserId: bigint;
    openid: string;
    userId: bigint | null;
    receivedAt: number;
  },
  cfg: WechatMpRuntimeConfig,
): Promise<InboundDispatch | null> {
  if (inbound.msgType === "event") {
    if (inbound.event === "subscribe")
      return { text: cfg.texts.greeting, kind: "welcome", status: "ok" };
    return null; // 取关/菜单点击等无需回复
  }
  if (inbound.msgType !== "text") {
    return { text: cfg.texts.help, kind: "unsupported", status: "ok" };
  }

  const text = normalizeInput(inbound.content ?? "");
  if (text === "") return { text: cfg.texts.help, kind: "help", status: "ok" };

  if (isHelpWord(text)) return { text: cfg.texts.help, kind: "help", status: "ok" };
  if (isContinueWord(text)) return continueReply(ctx.openid, cfg);
  if (isHandoffPhrase(text, cfg.handoffKeywords)) {
    return handoff(text, { ...ctx, messageId: ctx.messageId }, cfg);
  }
  const bound = await tryBind(text, ctx.openid, cfg);
  if (bound) return bound;

  const keyword = await keywordReply(text);
  if (keyword) return keyword;

  if (isTooLongQuery(text)) return { text: cfg.texts.tooLong, kind: "fallback", status: "ok" };
  if (await isBlocked(text)) return { text: cfg.texts.blocked, kind: "blocked", status: "blocked" };

  return requestAnswer(
    {
      openid: ctx.openid,
      wechatMsgId: inbound.dedupeKey,
      query: text,
      messageId: ctx.messageId,
      receivedAt: ctx.receivedAt,
    },
    cfg,
  );
}

function renderReply(
  cfg: WechatMpRuntimeConfig,
  inbound: InboundMessage,
  encrypted: boolean,
  text: string,
): string {
  const body = truncateUtf8(text, WECHAT_MP_REPLY_MAX_BYTES);
  if (encrypted) {
    return buildEncryptedReplyXml({
      toUser: inbound.fromUserName,
      fromUser: inbound.toUserName,
      content: body,
      token: cfg.token,
      encodingAESKey: cfg.encodingAESKey,
      appId: cfg.appId,
    });
  }
  return buildTextReplyXml({
    toUser: inbound.fromUserName,
    fromUser: inbound.toUserName,
    content: body,
  });
}

/** 入站主链路(POST):验签 → 解密 → 幂等 → 分派 → XML 回复 */
export async function handleWechatMpPost(
  rawBody: string,
  sp: URLSearchParams,
): Promise<WechatMpHttpResult> {
  const receivedAt = Date.now();
  const cfg = await getWechatMpRuntimeConfig();
  if (!cfg) {
    logger.warn({ event: "wechat_mp.not_configured" });
    return xml("success");
  }

  const timestamp = sp.get("timestamp") ?? "";
  const nonce = sp.get("nonce") ?? "";
  const encrypted = (sp.get("encrypt_type") ?? "") === "aes";

  let plainXml = rawBody;
  if (encrypted) {
    const envelope = parseEncryptedEnvelope(rawBody);
    if (!envelope) return fail(400);
    const msgSignature = sp.get("msg_signature") ?? "";
    if (
      !safeEqualHex(
        computeMsgSignature(cfg.token, timestamp, nonce, envelope.encrypt),
        msgSignature,
      )
    ) {
      return fail(403);
    }
    try {
      plainXml = decryptMessage({
        encodingAESKey: cfg.encodingAESKey,
        encrypt: envelope.encrypt,
        appId: cfg.appId,
      });
    } catch (e) {
      logger.warn({
        event: "wechat_mp.decrypt_failed",
        error: e instanceof Error ? e.message : String(e),
      });
      return fail(400);
    }
  } else if (
    !safeEqualHex(computeSignature(cfg.token, timestamp, nonce), sp.get("signature") ?? "")
  ) {
    return fail(403);
  }

  let inbound: InboundMessage;
  try {
    inbound = parseInbound(plainXml);
  } catch (e) {
    logger.warn({
      event: "wechat_mp.parse_failed",
      error: e instanceof Error ? e.message : String(e),
    });
    return xml("success");
  }

  if (!cfg.enabled) {
    logger.info({ event: "wechat_mp.disabled_skip", msgType: inbound.msgType });
    return xml("success");
  }

  const user = await ensureChannelUser(inbound.fromUserName);
  const claim = await claimInboundMessage({
    channelUserId: user.id,
    wechatMsgId: inbound.dedupeKey,
    msgType: inbound.msgType,
    event: inbound.event,
    content: inbound.content ?? inbound.event ?? "",
  });

  if (claim.duplicate) {
    // 微信重试:直接回已存出站;无出站则空串止住重试
    const stored = await findStoredReply(inbound.dedupeKey);
    logger.info({ event: "wechat_mp.duplicate_msg", reused: Boolean(stored) });
    return stored ? xml(renderReply(cfg, inbound, encrypted, stored)) : xml("success");
  }

  await syncSubscribeState(inbound.fromUserName, inbound).catch(() => undefined);

  const started = Date.now();
  let result: InboundDispatch | null;
  try {
    result = await dispatch(
      inbound,
      {
        messageId: claim.id,
        channelUserId: user.id,
        openid: inbound.fromUserName,
        userId: user.userId,
        receivedAt,
      },
      cfg,
    );
  } catch (e) {
    logger.error({
      event: "wechat_mp.dispatch_failed",
      error: e instanceof Error ? e.message : String(e),
    });
    result = { text: cfg.texts.error, kind: "fallback", status: "error" };
  }

  if (!result) return xml("success");

  await saveOutboundMessage({
    channelUserId: user.id,
    inboundMsgId: inbound.dedupeKey,
    content: truncateUtf8(result.text, WECHAT_MP_REPLY_MAX_BYTES),
    replyKind: result.kind,
    answerStatus: result.status ?? null,
    latencyMs: Date.now() - started,
  }).catch((e: unknown) => {
    logger.warn({
      event: "wechat_mp.outbound_save_failed",
      error: e instanceof Error ? e.message : String(e),
    });
  });

  return xml(renderReply(cfg, inbound, encrypted, result.text));
}
