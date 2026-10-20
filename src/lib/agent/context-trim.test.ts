/**
 * 上下文瘦身单测(2026-10-20 富 HTML):规则 1 剥已渲染卡的 args.html(最近 2 次
 * 原样、width/maxHeight 保留、未应答的不动);规则 2 仅超阈值时精简旧 brief/guide,
 * 每种留最近一次;write_article/save_topic_draft 结果与 human 消息永不改;
 * 无改动同引用返回(零拷贝契约)。
 */
import { AIMessage, HumanMessage, ToolMessage } from "langchain";
import { describe, expect, it } from "vitest";

import {
  OLD_TOOL_RESULT_PLACEHOLDER,
  RENDER_CARD_HTML_PLACEHOLDER,
  trimContextMessages,
} from "./context-trim";

function aiCall(id: string, name: string, args: Record<string, unknown>): AIMessage {
  return new AIMessage({ content: "", tool_calls: [{ id, name, args }] });
}

function toolResult(id: string, name: string, content: string): ToolMessage {
  return new ToolMessage({ content, tool_call_id: id, name });
}

describe("trimContextMessages 规则 1(已渲染卡的 HTML 参数)", () => {
  it("只有一张卡时不动(最近 2 次恒原样,防模型回读自己参数误判重渲)", () => {
    const call = aiCall("c1", "render_card", { html: "<div>".repeat(500), width: 900 });
    const result = toolResult("c1", "render_card", '{"ok":true,"url":"/wp-content/uploads/a.png"}');
    const messages = [new HumanMessage("写卡"), call, result];
    const out = trimContextMessages(messages);
    expect(out.messages).toBe(messages);
    expect(out.stats.strippedHtmlArgs).toBe(0);
  });

  it("超过 2 张:较旧的 html 被占位,最近两张与全部工具结果原样", () => {
    const mk = (n: number) =>
      aiCall(`c${n}`, "render_card", { html: `<div>${"x".repeat(500)}</div>${n}`, width: 900 });
    const mr = (n: number) =>
      toolResult(`c${n}`, "render_card", `{"ok":true,"url":"/wp-content/uploads/${n}.png"}`);
    const messages = [new HumanMessage("写卡"), mk(1), mr(1), mk(2), mr(2), mk(3), mr(3)];
    const out = trimContextMessages(messages);
    const calls = (out.messages[1] as AIMessage).tool_calls!;
    expect(calls[0]!.args.html).toBe(RENDER_CARD_HTML_PLACEHOLDER); // 第 1 张被压缩
    expect(calls[0]!.args.width).toBe(900); // 其余参数保留
    expect(out.messages[3]).toBe(messages[3]); // 第 2、3 张原样
    expect(out.messages[5]).toBe(messages[5]);
    expect(out.messages[6]).toBe(messages[6]); // 工具结果不动
    expect(out.stats.strippedHtmlArgs).toBe(1);
    expect(out.stats.charsAfter).toBeLessThan(out.stats.charsBefore);
  });

  it("历史 preset 调用(无 html 字段)不动;未应答的 render_card 也不动", () => {
    const presetCall = aiCall("c1", "render_card", { preset: "stats", data: { items: [] } });
    const pending = aiCall("c2", "render_card", { html: "<div>x</div>" }); // 无 ToolMessage
    const out = trimContextMessages([
      new HumanMessage("h"),
      presetCall,
      toolResult("c1", "render_card", "ok"),
      pending,
    ]);
    expect(out.messages).toBe(out.messages); // 引用稳定
    expect(out.messages[1]).toBe(presetCall);
    expect(out.messages[3]).toBe(pending);
    expect(out.stats.strippedHtmlArgs).toBe(0);
  });
});

describe("trimContextMessages 规则 2(阈值内外的旧工具结果)", () => {
  const brief = (id: string, size: number) =>
    toolResult(id, "get_topic_brief", "素材".repeat(size));

  it("低于阈值:brief 结果原样,数组同引用", () => {
    const messages = [
      new HumanMessage("h"),
      aiCall("a1", "get_topic_brief", { topic_id: "1" }),
      brief("a1", 100),
      aiCall("a2", "get_topic_brief", { topic_id: "1" }),
      brief("a2", 100),
    ];
    const out = trimContextMessages(messages, { maxChars: 1_000_000 });
    expect(out.messages).toBe(messages);
    expect(out.stats.shortenedResults).toBe(0);
  });

  it("超阈值:每种工具只留最近一次,其余占位;write_article 结果不动", () => {
    const messages = [
      new HumanMessage("h"),
      aiCall("a1", "get_topic_brief", { topic_id: "1" }),
      brief("a1", 300),
      aiCall("a2", "get_topic_brief", { topic_id: "1" }),
      brief("a2", 300),
      aiCall("w1", "write_article", { topic_id: "1" }),
      toolResult("w1", "write_article", "写".repeat(5_000)),
      aiCall("s1", "save_topic_draft", {}),
      toolResult("s1", "save_topic_draft", "存".repeat(2_000)),
    ];
    const out = trimContextMessages(messages, { maxChars: 1_000 });
    expect((out.messages[2] as ToolMessage).content).toBe(OLD_TOOL_RESULT_PLACEHOLDER);
    expect(out.messages[4]).toBe(messages[4]); // 最近一次保留
    expect(out.messages[6]).toBe(messages[6]); // write_article 结果永不改
    expect(out.messages[8]).toBe(messages[8]); // save_topic_draft 结果永不改
    expect(out.messages[0]).toBe(messages[0]);
    expect(out.stats.shortenedResults).toBe(1);
  });

  it("get_skill/list_skills 同样瘦身且互不串扰", () => {
    const messages = [
      aiCall("l1", "list_skills", {}),
      toolResult("l1", "list_skills", "l".repeat(500)),
      aiCall("g1", "get_skill", { key: "card-rendering" }),
      toolResult("g1", "get_skill", "g".repeat(500)),
      aiCall("l2", "list_skills", {}),
      toolResult("l2", "list_skills", "l".repeat(500)),
      aiCall("g2", "get_skill", { key: "card-rendering" }),
      toolResult("g2", "get_skill", "g".repeat(500)),
    ];
    const out = trimContextMessages(messages, { maxChars: 100 });
    expect((out.messages[1] as ToolMessage).content).toBe(OLD_TOOL_RESULT_PLACEHOLDER);
    expect((out.messages[3] as ToolMessage).content).toBe(OLD_TOOL_RESULT_PLACEHOLDER);
    expect(out.messages[5]).toBe(messages[5]);
    expect(out.messages[7]).toBe(messages[7]);
  });

  it("无 render_card 且未超阈值 → 同一数组引用(零拷贝快路径)", () => {
    const messages = [new HumanMessage("h"), new AIMessage("回答")];
    expect(trimContextMessages(messages).messages).toBe(messages);
  });
});
