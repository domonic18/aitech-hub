/**
 * 答案卡 SSE 协议单测(K2):帧化形状、粘包/半截帧解析、CRLF 容忍、
 * 非法类型/坏 JSON 丢弃、编码-解析 round trip。
 */
import { describe, expect, it } from "vitest";

import { encodeAnswerEvent, parseSseBlocks, type AnswerEvent } from "./answer-protocol";

const EVENTS: AnswerEvent[] = [
  {
    type: "meta",
    total: 3,
    noHits: false,
    cites: [{ n: 1, kind: "post", title: "t", href: "/post/1-x/", snippet: "s" }],
    generatedAt: "2026-10-06T00:00:00.000Z",
  },
  { type: "delta", text: "答案" },
  { type: "done", durationMs: 1200, followUps: ["追问一"] },
  { type: "unavailable", reason: "quota" },
];

describe("encodeAnswerEvent", () => {
  it("event 行 + data 行 + 空行收尾", () => {
    const frame = encodeAnswerEvent({ type: "delta", text: "你" });
    expect(frame).toBe('event: delta\ndata: {"type":"delta","text":"你"}\n\n');
  });
});

describe("parseSseBlocks", () => {
  it("round trip:四事件编码后整体解析还原", () => {
    const buf = EVENTS.map(encodeAnswerEvent).join("");
    expect(parseSseBlocks(buf).events).toEqual(EVENTS);
  });

  it("分块不对齐:半截帧留 rest,拼上下一块后完整解析", () => {
    const full = EVENTS.map(encodeAnswerEvent).join("");
    const cut = full.indexOf("event: done");
    const p1 = parseSseBlocks(full.slice(0, cut + 3)); // "eve" 半截
    expect(p1.events.map((e) => e.type)).toEqual(["meta", "delta"]);
    const p2 = parseSseBlocks(p1.rest + full.slice(cut + 3));
    expect(p2.events.map((e) => e.type)).toEqual(["done", "unavailable"]);
    expect(p2.rest).toBe("");
  });

  it("CRLF 容忍;坏 JSON/未知类型帧丢弃不炸", () => {
    const buf =
      'event: delta\r\ndata: {"type":"delta","text":"a"}\r\n\r\n' +
      'data: not-json\n\nevent: x\ndata: {"type":"x"}\n\n';
    const p = parseSseBlocks(buf);
    expect(p.events).toEqual([{ type: "delta", text: "a" }]);
  });
});
