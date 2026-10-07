/**
 * sse 单测:encodeWireEvent 产出帧的逆变换——整块喂、跨 chunk 任意切分、
 * 尾帧无空行收尾、注释行/非 JSON data 防御丢弃。
 */
import { describe, expect, it } from "vitest";

import { createSseEventReader } from "./sse";
import { encodeWireEvent } from "./wire";

describe("createSseEventReader", () => {
  it("整块喂:连续多帧一次解出,顺序保持", () => {
    const reader = createSseEventReader();
    const chunk =
      encodeWireEvent("metadata", { run_id: "r1", thread_id: "t1" }) +
      encodeWireEvent("messages", [{ type: "ai", content: "你好" }, {}]) +
      encodeWireEvent("end", {});
    expect(reader.push(chunk)).toEqual([
      { event: "metadata", data: { run_id: "r1", thread_id: "t1" } },
      { event: "messages", data: [{ type: "ai", content: "你好" }, {}] },
      { event: "end", data: {} },
    ]);
    expect(reader.end()).toEqual([]);
  });

  it("跨 chunk 任意切分:逐位置切开喂不丢帧不重帧", () => {
    const chunk =
      encodeWireEvent("metadata", { run_id: "r1", thread_id: "t1" }) +
      encodeWireEvent("messages", [{ type: "ai", content: "含\n换行与中文✓" }, {}]) +
      encodeWireEvent("end", {});
    const expected = createSseEventReader().push(chunk);
    for (let i = 1; i < chunk.length; i++) {
      const reader = createSseEventReader();
      const got = [
        ...reader.push(chunk.slice(0, i)),
        ...reader.push(chunk.slice(i)),
        ...reader.end(),
      ];
      expect(got).toEqual(expected);
    }
  });

  it("尾帧无空行收尾:end() 兜住最后一帧", () => {
    const reader = createSseEventReader();
    expect(reader.push('event: error\ndata: {"message":"处理中断,请重试"}')).toEqual([]);
    expect(reader.end()).toEqual([{ event: "error", data: { message: "处理中断,请重试" } }]);
  });

  it("注释行与非 JSON data 防御丢弃,event 值剥单个前导空格", () => {
    const reader = createSseEventReader();
    const got = reader.push(": keep-alive\n\n:event: x\n\nevent: messages\ndata: not-json\n\n");
    expect(got).toEqual([]);
    expect(reader.push("event:  end\ndata: {}\n\n")).toEqual([{ event: " end", data: {} }]);
  });
});
