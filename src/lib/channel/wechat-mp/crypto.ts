/**
 * 公众号消息验签与加解密(M66,官方「消息加解密说明」的 TypeScript 实现)。
 *
 * 三个协议面:
 * - 服务器配置校验(GET):`sha1(sort(token, timestamp, nonce).join(""))`,回显 echostr 明文。
 * - 明文/兼容模式(POST):XML 直接可读,同款签名校验。
 * - 安全模式(POST):`<Encrypt>` 密文 + `msg_signature = sha1(sort(token, ts, nonce, encrypt))`;
 *   回复也须加密并带签名。
 *
 * AES 细节(官方口径,错一处即静默失败,故单测锁死):AES-256-CBC,
 * key = base64decode(EncodingAESKey + "=")(32B),iv = key 前 16B,
 * 明文布局 = random(16) | msgLen(4, 大端) | msg | appid,Pkcs7 块长 32。
 *
 * 纯函数模块:零 prisma / 零 redis / 零网络。
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** EncodingAESKey 的字符长度(官方规定 43 位) */
export const ENCODING_AES_KEY_LENGTH = 43;
/** 解码后的 AES 密钥字节数 */
export const AES_KEY_BYTES = 32;
/** Pkcs7 补位块长(注意不是 16) */
export const PKCS7_BLOCK = 32;

/** CDATA 内的 `]]>` 官方转义形态:`]]]]><![CDATA[>` */
const CDATA_SPLIT = "]]]]><![CDATA[>";

function sha1Hex(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("hex");
}

/** 定长十六进制签名比较(长度不等直接 false;等长走 timingSafeEqual) */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/** 服务器配置校验签名(GET / 明文 POST) */
export function computeSignature(token: string, timestamp: string, nonce: string): string {
  return sha1Hex([token, timestamp, nonce].sort().join(""));
}

/** 安全模式消息签名(GET 之外的所有加密请求/回复) */
export function computeMsgSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): string {
  return sha1Hex([token, timestamp, nonce, encrypt].sort().join(""));
}

/** EncodingAESKey(43 位) → 32B 密钥;长度不符直接抛,避免静默用错 key */
export function decodeAesKey(encodingAESKey: string): Buffer {
  const trimmed = encodingAESKey.trim();
  if (trimmed.length !== ENCODING_AES_KEY_LENGTH) {
    throw new Error(`EncodingAESKey 长度应为 ${ENCODING_AES_KEY_LENGTH} 位,实际 ${trimmed.length}`);
  }
  const key = Buffer.from(`${trimmed}=`, "base64");
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(`EncodingAESKey 解码后应为 ${AES_KEY_BYTES} 字节,实际 ${key.length}`);
  }
  return key;
}

/** 解密 `<Encrypt>` 载荷;appId 传入即强校验(防串号),不符抛错 */
export function decryptMessage(opts: {
  encodingAESKey: string;
  encrypt: string;
  appId?: string;
}): string {
  const key = decodeAesKey(opts.encodingAESKey);
  const iv = key.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const buf = Buffer.concat([
    decipher.update(Buffer.from(opts.encrypt, "base64")),
    decipher.final(),
  ]);

  const pad = buf[buf.length - 1] ?? 0;
  if (pad < 1 || pad > PKCS7_BLOCK) throw new Error("解密失败:补位非法");
  const content = buf.subarray(0, buf.length - pad);
  if (content.length < 20) throw new Error("解密失败:载荷过短");

  const msgLen = content.readUInt32BE(16);
  if (20 + msgLen > content.length) throw new Error("解密失败:长度前缀越界");

  const msg = content.subarray(20, 20 + msgLen).toString("utf8");
  const fromAppId = content.subarray(20 + msgLen).toString("utf8");
  if (opts.appId && fromAppId !== opts.appId) {
    throw new Error(`解密失败:appid 不匹配(收到 ${fromAppId})`);
  }
  return msg;
}

/** 加密回复明文;每次随机 16B 前缀,同文两次输出天然不同 */
export function encryptMessage(opts: {
  encodingAESKey: string;
  appId: string;
  plaintext: string;
}): string {
  const key = decodeAesKey(opts.encodingAESKey);
  const iv = key.subarray(0, 16);
  const msg = Buffer.from(opts.plaintext, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msg.length, 0);
  const raw = Buffer.concat([randomBytes(16), lenBuf, msg, Buffer.from(opts.appId, "utf8")]);

  const padLen = PKCS7_BLOCK - (raw.length % PKCS7_BLOCK);
  const padded = Buffer.concat([raw, Buffer.alloc(padLen, padLen)]);

  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

// ---------------------------------------------------------------------------
// XML 读写(极简实现:公众号消息体固定十来个小标签,不引 XML 库)
// ---------------------------------------------------------------------------

/** `<Tag><![CDATA[...]]></Tag>` 或 `<Tag>纯值</Tag>`;未命中返回 null */
export function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`);
  const m = re.exec(xml);
  if (!m) return null;
  const raw = m[1] ?? m[2] ?? "";
  return raw.split(CDATA_SPLIT).join("]]>").trim();
}

/** XML 文本节点安全包裹(官方转义 `]]>`) */
function cdata(value: string): string {
  return `<![CDATA[${value.split("]]>").join(CDATA_SPLIT)}]]>`;
}

export interface EncryptedEnvelope {
  toUserName: string;
  encrypt: string;
}

/** 识别安全模式请求体;非加密形态返回 null(调用方走明文分支) */
export function parseEncryptedEnvelope(xml: string): EncryptedEnvelope | null {
  const encrypt = extractTag(xml, "Encrypt");
  if (!encrypt) return null;
  return { toUserName: extractTag(xml, "ToUserName") ?? "", encrypt };
}

export interface InboundMessage {
  toUserName: string;
  fromUserName: string;
  createTime: string;
  msgType: string;
  /** 文本消息正文;非文本为 null */
  content: string | null;
  /** 微信消息 ID(文本等普通消息有;事件消息没有) */
  msgId: string | null;
  /** 事件类型(subscribe/unsubscribe/CLICK/…);非事件为 null */
  event: string | null;
  eventKey: string | null;
  /**
   * 幂等键(官方口径):普通消息用 MsgId,事件用 `FromUserName + CreateTime`。
   * 微信重试会原样重发同一键,是「不重复回复」的唯一锚点。
   */
  dedupeKey: string;
}

/** 解析解密后的明文 XML(或明文模式请求体) */
export function parseInbound(xml: string): InboundMessage {
  const toUserName = extractTag(xml, "ToUserName") ?? "";
  const fromUserName = extractTag(xml, "FromUserName") ?? "";
  const createTime = extractTag(xml, "CreateTime") ?? "";
  const msgType = extractTag(xml, "MsgType") ?? "";
  const msgId = extractTag(xml, "MsgId");
  const event = extractTag(xml, "Event");
  if (!fromUserName) throw new Error("入站消息缺 FromUserName");

  return {
    toUserName,
    fromUserName,
    createTime,
    msgType,
    content: extractTag(xml, "Content"),
    msgId,
    event,
    eventKey: extractTag(xml, "EventKey"),
    dedupeKey: msgId ? `msg:${msgId}` : `event:${fromUserName}:${createTime}:${event ?? ""}`,
  };
}

/** 明文模式文本回复(兼容模式亦用此形态) */
export function buildTextReplyXml(opts: {
  toUser: string;
  fromUser: string;
  content: string;
  createTime?: number;
}): string {
  const ts = opts.createTime ?? Math.floor(Date.now() / 1000);
  return [
    "<xml>",
    `<ToUserName>${cdata(opts.toUser)}</ToUserName>`,
    `<FromUserName>${cdata(opts.fromUser)}</FromUserName>`,
    `<CreateTime>${ts}</CreateTime>`,
    "<MsgType><![CDATA[text]]></MsgType>",
    `<Content>${cdata(opts.content)}</Content>`,
    "</xml>",
  ].join("");
}

/** 安全模式回复:明文 → 加密 → 套签名信封 */
export function buildEncryptedReplyXml(opts: {
  toUser: string;
  fromUser: string;
  content: string;
  token: string;
  encodingAESKey: string;
  appId: string;
  createTime?: number;
  timestamp?: string;
  nonce?: string;
}): string {
  const ts = opts.createTime ?? Math.floor(Date.now() / 1000);
  const plain = buildTextReplyXml({
    toUser: opts.toUser,
    fromUser: opts.fromUser,
    content: opts.content,
    createTime: ts,
  });
  const encrypt = encryptMessage({
    encodingAESKey: opts.encodingAESKey,
    appId: opts.appId,
    plaintext: plain,
  });
  const timestamp = opts.timestamp ?? String(ts);
  const nonce = opts.nonce ?? randomBytes(8).toString("hex");
  const signature = computeMsgSignature(opts.token, timestamp, nonce, encrypt);
  return [
    "<xml>",
    `<Encrypt>${cdata(encrypt)}</Encrypt>`,
    `<MsgSignature>${cdata(signature)}</MsgSignature>`,
    `<TimeStamp>${timestamp}</TimeStamp>`,
    `<Nonce>${cdata(nonce)}</Nonce>`,
    "</xml>",
  ].join("");
}

/**
 * 按 UTF-8 字节截断(不切半个字符)。公众号文本上限 2048 **字节**,
 * 实测打满会静默失败,调用方一律按更小的预算(见 constants)传入。
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > maxBytes) break;
    out += ch;
    bytes += b;
  }
  return out;
}
