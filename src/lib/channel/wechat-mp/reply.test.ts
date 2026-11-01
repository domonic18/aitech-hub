/**
 * L0 直答判定与话术拼装单测(M66):触发词全等/包含语义、绑定码形态、
 * 关键词最长命中、文章回复的 URL 构造。这些是「用户发一句话到底走哪一档」
 * 的唯一真相,错一条就是线上答非所问或绑定码误判,故逐条钉死。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_SITE_URL: "https://17aitech.com" },
}));

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

describe("normalizeInput", () => {
  it("剥前后空白并压平中间空白", () => {
    expect(normalizeInput("  继续 \n\t ")).toBe("继续");
    expect(normalizeInput("a   b\nc")).toBe("a b c");
  });
});

describe("isContinueWord", () => {
  it("全等命中继续词,大小写与空白不敏感", () => {
    expect(isContinueWord("继续")).toBe(true);
    expect(isContinueWord("  继续  ")).toBe(true);
    expect(isContinueWord("继续获取")).toBe(true);
    expect(isContinueWord("继续吧")).toBe(true);
  });

  it("包含但非全等不算(「继续吗」不应触发续读)", () => {
    expect(isContinueWord("继续吗")).toBe(false);
    expect(isContinueWord("请继续")).toBe(false);
    expect(isContinueWord("")).toBe(false);
  });
});

describe("isHelpWord", () => {
  it("帮助词全等命中,大小写不敏感", () => {
    expect(isHelpWord("帮助")).toBe(true);
    expect(isHelpWord("HELP")).toBe(true);
    expect(isHelpWord("?")).toBe(true);
    expect(isHelpWord("？")).toBe(true);
    expect(isHelpWord("怎么用")).toBe(true);
  });

  it("「帮助我」不是帮助指令", () => {
    expect(isHelpWord("帮助我")).toBe(false);
  });
});

describe("isHandoffPhrase", () => {
  const keywords = ["人工", "客服", "投诉"];

  it("包含即触发(「我要转人工」也识别)", () => {
    expect(isHandoffPhrase("我要转人工", keywords)).toBe(true);
    expect(isHandoffPhrase("找客服", keywords)).toBe(true);
    expect(isHandoffPhrase("投诉一下", keywords)).toBe(true);
  });

  it("大小写不敏感;空白关键词忽略", () => {
    expect(isHandoffPhrase("VIP 客服", ["vip"])).toBe(true);
    expect(isHandoffPhrase("随便", ["", "   "])).toBe(false);
  });

  it("未命中返回 false", () => {
    expect(isHandoffPhrase("这篇文章怎么写的", keywords)).toBe(false);
  });
});

describe("looksLikeBindCode", () => {
  it("8 位 + 字符集内(小写自动转大写)", () => {
    expect(looksLikeBindCode("ABCD2345")).toBe(true);
    expect(looksLikeBindCode("abcd2345")).toBe(true);
    expect(looksLikeBindCode("  ABCD2345  ")).toBe(true);
  });

  it("长度不符或含易混字符(0/O/1/I/L)即否", () => {
    expect(looksLikeBindCode("ABCD234")).toBe(false);
    expect(looksLikeBindCode("ABCD23456")).toBe(false);
    expect(looksLikeBindCode("ABCD2340")).toBe(false);
    expect(looksLikeBindCode("ABCD234O")).toBe(false);
    expect(looksLikeBindCode("ABCD2341")).toBe(false);
    expect(looksLikeBindCode("ABCD234I")).toBe(false);
    expect(looksLikeBindCode("ABCD234L")).toBe(false);
  });
});

describe("isTooLongQuery", () => {
  it("500 字为界(> 才超长)", () => {
    expect(isTooLongQuery("a".repeat(500))).toBe(false);
    expect(isTooLongQuery("a".repeat(501))).toBe(true);
  });
});

describe("matchKeyword", () => {
  const rows = [
    { keyword: "MedTrinity" },
    { keyword: "Med" },
    { keyword: "  " },
    { keyword: "价格" },
  ];

  it("包含匹配且大小写不敏感,取最长关键词", () => {
    expect(matchKeyword("medtrinity 是什么", rows)?.keyword).toBe("MedTrinity");
    expect(matchKeyword("med 是什么", rows)?.keyword).toBe("Med");
  });

  it("空文本 / 空关键词表返回 null", () => {
    expect(matchKeyword("   ", rows)).toBeNull();
    expect(matchKeyword("价格", [])).toBeNull();
    expect(matchKeyword("价格", [{ keyword: "  " }])).toBeNull();
  });

  it("未命中返回 null", () => {
    expect(matchKeyword("今天天气", rows)).toBeNull();
  });
});

describe("buildKeywordReply", () => {
  const fallbackText = "没找到相关内容";

  it("挂文章:标题 + 摘要 + 完整链接(链接单独成行便于长按复制)", () => {
    const text = buildKeywordReply({
      keyword: "MedTrinity",
      post: {
        id: BigInt(313),
        slug: "medtrinity",
        title: "MedTrinity 评测",
        excerpt: "一句话摘要",
      },
      replyText: null,
      fallbackText,
    });
    expect(text).toBe("《MedTrinity 评测》\n一句话摘要\nhttps://17aitech.com/post/313-medtrinity/");
  });

  it("slug 为空 → bare-id URL;摘要为空白时整行省略", () => {
    const text = buildKeywordReply({
      keyword: "k",
      post: { id: 58, slug: null, title: "纯中文标题", excerpt: "   " },
      replyText: null,
      fallbackText,
    });
    expect(text).toBe("《纯中文标题》\nhttps://17aitech.com/post/58/");
  });

  it("摘要截到 120 字", () => {
    const text = buildKeywordReply({
      keyword: "k",
      post: { id: BigInt(1), slug: "a", title: "T", excerpt: "x".repeat(200) },
      replyText: null,
      fallbackText,
    });
    const lines = text.split("\n");
    expect(lines[1]).toHaveLength(120);
  });

  it("无文章:优先后台话术,其次兜底文本", () => {
    expect(
      buildKeywordReply({ keyword: "k", post: null, replyText: " 自定义话术 ", fallbackText }),
    ).toBe("自定义话术");
    expect(buildKeywordReply({ keyword: "k", post: null, replyText: "   ", fallbackText })).toBe(
      fallbackText,
    );
    expect(buildKeywordReply({ keyword: "k", post: null, replyText: null, fallbackText })).toBe(
      fallbackText,
    );
  });
});
