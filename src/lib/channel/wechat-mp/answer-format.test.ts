/**
 * 公众号答案纯函数单测(M66):模型输出契约解析 + 出站文本组装。
 * 线上最贵的两个静默失败——模型输出夹带废话导致解析失败、回复超 2048
 * 字节被微信直接吞掉——都落在这两个函数里,故按边界逐条钉死。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_SITE_URL: "https://17aitech.com" },
}));

import { composeReplyText, parseAnswerPayload, WECHAT_MP_TRUNCATE_SUFFIX } from "./answer-format";
import { WECHAT_MP_REPLY_MAX_BYTES } from "./constants";

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

describe("parseAnswerPayload", () => {
  it("标准 JSON 对象", () => {
    const r = parseAnswerPayload('{"canAnswer":true,"answer":"结论","citeIds":[1,2]}');
    expect(r).toEqual({
      ok: true,
      data: { canAnswer: true, answer: "结论", citeIds: [1, 2] },
    });
  });

  it("容忍 ```json 围栏与前后废话,只取首个 { 到末个 }", () => {
    const raw =
      '好的,结果如下:\n```json\n{"canAnswer":true,"answer":"a","citeIds":[]}\n```\n以上。';
    const r = parseAnswerPayload(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.answer).toBe("a");
  });

  it("answer 去首尾空白", () => {
    const r = parseAnswerPayload('{"canAnswer":true,"answer":"  x  ","citeIds":[]}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.answer).toBe("x");
  });

  it("非 JSON / 非对象 → 失败", () => {
    expect(parseAnswerPayload("没有花括号").ok).toBe(false);
    expect(parseAnswerPayload("{}").ok).toBe(false);
    expect(parseAnswerPayload("[1,2]").ok).toBe(false);
    expect(parseAnswerPayload("{坏 json}").ok).toBe(false);
  });

  it("canAnswer / answer 缺失或类型不符 → 失败", () => {
    expect(parseAnswerPayload('{"answer":"a"}').ok).toBe(false);
    expect(parseAnswerPayload('{"canAnswer":"true","answer":"a"}').ok).toBe(false);
    expect(parseAnswerPayload('{"canAnswer":true}').ok).toBe(false);
    expect(parseAnswerPayload('{"canAnswer":true,"answer":1}').ok).toBe(false);
  });

  it("citeIds 只保留正整数,最多 8 个", () => {
    const raw = JSON.stringify({
      canAnswer: true,
      answer: "a",
      citeIds: [1, "2", 0, -1, 3.5, 4, 5, 6, 7, 8, 9, 10],
    });
    const r = parseAnswerPayload(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.citeIds).toEqual([1, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("citeIds 非数组按空数组处理(不整体判失败)", () => {
    const r = parseAnswerPayload('{"canAnswer":false,"answer":"","citeIds":"1,2"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.citeIds).toEqual([]);
  });
});

describe("composeReplyText", () => {
  const cites = [
    { title: "甲", href: "/post/1-a/" },
    { title: "乙", href: "https://17aitech.com/post/2-b/" },
    { title: "丙", href: "/post/3-c/" },
  ];

  it("短答案 + 引用:最多带 2 条,链接补成绝对地址", () => {
    const { text, truncated } = composeReplyText("结论正文", cites);
    expect(truncated).toBe(false);
    expect(text).toContain("结论正文");
    expect(text).toContain("《甲》");
    expect(text).toContain("https://17aitech.com/post/1-a/");
    expect(text).toContain("《乙》");
    expect(text).not.toContain("《丙》");
    expect(bytes(text)).toBeLessThanOrEqual(WECHAT_MP_REPLY_MAX_BYTES);
  });

  it("无引用时不拼「参考」段", () => {
    const { text, truncated } = composeReplyText("只有正文", []);
    expect(text).toBe("只有正文");
    expect(truncated).toBe(false);
  });

  it("引用放不下时先砍引用(不是截正文)", () => {
    const long = "a".repeat(1760);
    const { text, truncated } = composeReplyText(long, cites);
    expect(truncated).toBe(false);
    expect(text).toBe(long);
    expect(bytes(text)).toBeLessThanOrEqual(WECHAT_MP_REPLY_MAX_BYTES);
  });

  it("正文本身超限才截断,并补提示;输出恒不超字节预算", () => {
    const long = "中".repeat(1000); // 3000 字节
    const { text, truncated } = composeReplyText(long, cites);
    expect(truncated).toBe(true);
    expect(text.endsWith(WECHAT_MP_TRUNCATE_SUFFIX)).toBe(true);
    expect(bytes(text)).toBeLessThanOrEqual(WECHAT_MP_REPLY_MAX_BYTES);
    // 按码点切:不得出现半个汉字(UTF-8 解码无替换符)
    expect(text).not.toContain("�");
  });

  it("恰好等于预算时不算截断", () => {
    const exact = "a".repeat(WECHAT_MP_REPLY_MAX_BYTES);
    const { text, truncated } = composeReplyText(exact, []);
    expect(truncated).toBe(false);
    expect(bytes(text)).toBe(WECHAT_MP_REPLY_MAX_BYTES);
  });
});
