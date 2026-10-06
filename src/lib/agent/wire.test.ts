/**
 * wire 单测:帧编码形态、AIMessageChunk 扁平序列化(tool_call_chunks index
 * 钉 number/args 对象兜底 stringify)、tool/human 消息字段、多模态块只留文本、
 * model_name 提取——以 react-langgraph normalize* 消费口径为锚。
 */
import { AIMessageChunk, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  encodeWireEvent,
  encodeWireMessage,
  serializeWireMessage,
  type WireMessageTuple,
} from "./wire";

describe("encodeWireEvent", () => {
  it("帧形态:event+data 两行块间空行", () => {
    expect(encodeWireEvent("metadata", { run_id: "r", thread_id: "t" })).toBe(
      'event: metadata\ndata: {"run_id":"r","thread_id":"t"}\n\n',
    );
  });
});

describe("serializeWireMessage", () => {
  it("AIMessageChunk:tool_call_chunks index 钉 number,args 对象兜底 stringify", () => {
    const chunk = new AIMessageChunk({
      id: "ai-1",
      content: "你好",
      tool_call_chunks: [
        { name: "search_site", args: '{"q":"', id: "call-1", index: 0, type: "tool_call_chunk" },
        // 对象形态 args(防 int 断流):序列化时转 string
        { name: "read_post", args: { id: "21" } as unknown as string, id: "call-2", index: 1 },
      ],
    });
    const w = serializeWireMessage(chunk);
    expect(w.type).toBe("ai");
    expect(w.id).toBe("ai-1");
    expect(w.content).toBe("你好");
    expect(w.tool_call_chunks).toEqual([
      { name: "search_site", args: '{"q":"', id: "call-1", index: 0, type: "tool_call_chunk" },
      { name: "read_post", args: '{"id":"21"}', id: "call-2", index: 1 },
    ]);
  });

  it("usage_metadata 透传(50k 护栏前端无需,但调试可观测)", () => {
    const chunk = new AIMessageChunk({
      content: "",
      usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
    expect(serializeWireMessage(chunk).usage_metadata).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    });
  });

  it("human 消息:type/content/id", () => {
    const w = serializeWireMessage(new HumanMessage("问题"));
    expect(w.type).toBe("human");
    expect(w.content).toBe("问题");
  });

  it("tool 消息:tool_call_id/name/status 补齐", () => {
    const m = new ToolMessage({ content: "结果", tool_call_id: "call-1", name: "search_site" });
    const w = serializeWireMessage(m);
    expect(w.type).toBe("tool");
    expect(w.tool_call_id).toBe("call-1");
    expect(w.name).toBe("search_site");
    expect(w.status).toBe("success");
  });

  it("多模态块只留文本(text_delta 同留)", () => {
    const chunk = new AIMessageChunk({
      content: [
        { type: "text", text: "a" },
        { type: "image_url", image_url: "http://x" },
        { type: "text_delta", text: "b" },
      ] as unknown as string,
    });
    expect(serializeWireMessage(chunk).content).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]);
  });
});

describe("encodeWireMessage", () => {
  it("messages 帧载荷为元组 [消息, {}]", () => {
    const frame = encodeWireMessage(new HumanMessage("q"));
    expect(frame.startsWith("event: messages\ndata: ")).toBe(true);
    const tuple = JSON.parse(frame.slice("event: messages\ndata: ".length)) as WireMessageTuple;
    expect(Array.isArray(tuple)).toBe(true);
    expect(tuple[0].type).toBe("human");
    expect(tuple[1]).toEqual({});
  });
});
