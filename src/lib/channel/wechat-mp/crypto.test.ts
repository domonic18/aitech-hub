/**
 * 公众号消息加解密单测(M66)。
 * 这里锁的是**微信协议面**:签名算式、AES 布局、CDATA `]]>` 转义、字节截断。
 * 这些错一处都是线上静默失败(用户只看到「该公众号暂时无法提供服务」),
 * 无法靠人工点一下发现,故覆盖必须实打实。
 */
import { describe, expect, it } from "vitest";

import {
  buildEncryptedReplyXml,
  buildTextReplyXml,
  computeMsgSignature,
  computeSignature,
  decodeAesKey,
  decryptMessage,
  encryptMessage,
  extractTag,
  parseEncryptedEnvelope,
  parseInbound,
  safeEqualHex,
  truncateUtf8,
} from "./crypto";

/** 32 字节确定性密钥 → 43 位 EncodingAESKey(去掉 base64 尾部 `=`) */
function aesKeyOf(seed = 0): string {
  const buf = Buffer.from(Array.from({ length: 32 }, (_, i) => (i + seed) % 256));
  return buf.toString("base64").replace(/=+$/, "");
}

/** 测试夹具:appId/token 一律用假值——真实 AppID/Token 属部署配置,
 *  不进仓库(否则会被 GitHub secret scanning 判为泄露)。协议层对取值无格式要求 */
const APP_ID = "wx-e2e-fixture-appid";
const TOKEN = "e2e-token-fixture";

describe("签名", () => {
  it("服务器校验签名 = sha1(sort(token, timestamp, nonce).join(''))", () => {
    // 期望值由 sha1 独立计算:1700000000 | abc123 | e2e-token-fixture 字典序拼串
    expect(computeSignature(TOKEN, "1700000000", "abc123")).toBe(
      "55494aff453b705fedf39311a56ae33d1b9dbf84",
    );
  });

  it("安全模式签名把 encrypt 一起排序", () => {
    expect(computeMsgSignature(TOKEN, "1700000000", "abc123", "encryptedpayload")).toBe(
      "1f6ef474da3e3beee701bb94c149e7c7727a3f86",
    );
  });

  it("safeEqualHex 长度不等直接 false,等长逐字节比较", () => {
    expect(safeEqualHex("abcd", "abcd")).toBe(true);
    expect(safeEqualHex("abcd", "abce")).toBe(false);
    expect(safeEqualHex("abcd", "abc")).toBe(false);
    expect(safeEqualHex("", "")).toBe(true);
  });
});

describe("AES 加解密", () => {
  it("decodeAesKey 长度不符即抛(不静默用错 key)", () => {
    expect(() => decodeAesKey("too-short")).toThrow(/43/);
    expect(decodeAesKey(aesKeyOf())).toHaveLength(32);
  });

  it("加密后再解密回到原文", () => {
    const key = aesKeyOf();
    const plain = "<xml><Content><![CDATA[你好,一起AI]]></Content></xml>";
    const encrypt = encryptMessage({ encodingAESKey: key, appId: APP_ID, plaintext: plain });
    expect(decryptMessage({ encodingAESKey: key, encrypt, appId: APP_ID })).toBe(plain);
  });

  it("同文两次加密结果不同(随机 16B 前缀),但都能解", () => {
    const key = aesKeyOf();
    const a = encryptMessage({ encodingAESKey: key, appId: APP_ID, plaintext: "same" });
    const b = encryptMessage({ encodingAESKey: key, appId: APP_ID, plaintext: "same" });
    expect(a).not.toBe(b);
    expect(decryptMessage({ encodingAESKey: key, encrypt: a, appId: APP_ID })).toBe("same");
    expect(decryptMessage({ encodingAESKey: key, encrypt: b, appId: APP_ID })).toBe("same");
  });

  it("appid 不匹配拒绝解密(防串号)", () => {
    const key = aesKeyOf();
    const encrypt = encryptMessage({ encodingAESKey: key, appId: "wx_other", plaintext: "x" });
    expect(() => decryptMessage({ encodingAESKey: key, encrypt, appId: APP_ID })).toThrow(/appid/);
  });

  it("密文损坏抛出而非返回空串", () => {
    const key = aesKeyOf();
    expect(() =>
      decryptMessage({ encodingAESKey: key, encrypt: "not-base64!!!", appId: APP_ID }),
    ).toThrow();
  });
});

describe("XML 读写", () => {
  const inboundXml = [
    "<xml>",
    "<ToUserName><![CDATA[gh_abc]]></ToUserName>",
    "<FromUserName><![CDATA[oUser_123]]></FromUserName>",
    "<CreateTime>1735689600</CreateTime>",
    "<MsgType><![CDATA[text]]></MsgType>",
    "<Content><![CDATA[你好,介绍一下 deepseek]]></Content>",
    "<MsgId>2468135790</MsgId>",
    "</xml>",
  ].join("");

  it("extractTag 支持 CDATA 与纯值两种形态", () => {
    expect(extractTag(inboundXml, "MsgType")).toBe("text");
    expect(extractTag(inboundXml, "MsgId")).toBe("2468135790");
    expect(extractTag(inboundXml, "Missing")).toBeNull();
  });

  it("解析文本消息:幂等键用 MsgId", () => {
    const msg = parseInbound(inboundXml);
    expect(msg.fromUserName).toBe("oUser_123");
    expect(msg.content).toBe("你好,介绍一下 deepseek");
    expect(msg.event).toBeNull();
    expect(msg.dedupeKey).toBe("msg:2468135790");
  });

  it("解析关注事件:无 MsgId,幂等键用 FromUserName+CreateTime", () => {
    const xml = [
      "<xml>",
      "<ToUserName><![CDATA[gh_abc]]></ToUserName>",
      "<FromUserName><![CDATA[oUser_123]]></FromUserName>",
      "<CreateTime>1735689600</CreateTime>",
      "<MsgType><![CDATA[event]]></MsgType>",
      "<Event><![CDATA[subscribe]]></Event>",
      "</xml>",
    ].join("");
    const msg = parseInbound(xml);
    expect(msg.event).toBe("subscribe");
    expect(msg.content).toBeNull();
    expect(msg.dedupeKey).toBe("event:oUser_123:1735689600:subscribe");
  });

  it("缺 FromUserName 视为畸形请求", () => {
    expect(() => parseInbound("<xml><MsgType>text</MsgType></xml>")).toThrow(/FromUserName/);
  });

  it("CDATA 内 ]]> 走官方转义,读回原文", () => {
    const xml = buildTextReplyXml({
      toUser: "oUser_123",
      fromUser: "gh_abc",
      content: "数组写法 a[0]]]>b",
      createTime: 1735689600,
    });
    expect(xml).toContain("]]]]><![CDATA[>");
    expect(extractTag(xml, "Content")).toBe("数组写法 a[0]]]>b");
  });

  it("回复 XML 含必要标签", () => {
    const xml = buildTextReplyXml({
      toUser: "oUser_123",
      fromUser: "gh_abc",
      content: "hi",
      createTime: 1735689600,
    });
    expect(xml).toContain("<ToUserName><![CDATA[oUser_123]]></ToUserName>");
    expect(xml).toContain("<CreateTime>1735689600</CreateTime>");
    expect(xml).toContain("<MsgType><![CDATA[text]]></MsgType>");
  });
});

describe("安全模式信封", () => {
  it("加密回复可解回明文,且签名可校验", () => {
    const key = aesKeyOf();
    const envelopeXml = buildEncryptedReplyXml({
      toUser: "oUser_123",
      fromUser: "gh_abc",
      content: "加密回复",
      token: TOKEN,
      encodingAESKey: key,
      appId: APP_ID,
      createTime: 1735689600,
      timestamp: "1735689600",
      nonce: "n0nce",
    });

    const envelope = parseEncryptedEnvelope(envelopeXml);
    expect(envelope).not.toBeNull();
    const plain = decryptMessage({
      encodingAESKey: key,
      encrypt: envelope!.encrypt,
      appId: APP_ID,
    });
    expect(extractTag(plain, "Content")).toBe("加密回复");
    expect(computeMsgSignature(TOKEN, "1735689600", "n0nce", envelope!.encrypt)).toBe(
      extractTag(envelopeXml, "MsgSignature"),
    );
  });

  it("明文请求体识别为 null(走明文分支)", () => {
    expect(parseEncryptedEnvelope("<xml><MsgType>text</MsgType></xml>")).toBeNull();
  });
});

describe("字节截断", () => {
  it("未超限原样返回", () => {
    expect(truncateUtf8("你好", 1800)).toBe("你好");
  });

  it("中文按 3 字节计算,不切半个字符", () => {
    const out = truncateUtf8("一".repeat(100), 1800);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(1800);
    // 600 个汉字 = 1800 字节,正好装下
    expect(out).toBe("一".repeat(100));
    // 差 2 字节装不下第 100 个汉字 → 只留 99 个(297 字节)
    const cut = truncateUtf8("一".repeat(100), 299);
    expect(Buffer.byteLength(cut, "utf8")).toBe(297);
    expect(cut).toBe("一".repeat(99));
  });

  it("emoji(4 字节码点)不产生半个字节", () => {
    const out = truncateUtf8("🙂".repeat(10), 9);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(9);
    expect(out).toBe("🙂🙂");
  });
});
