/** 厂商事件抽取契约单测(M58 批②):Zod 结构/超量截断/规范名/时间兜底/幂等锚。 */
import { describe, expect, it } from "vitest";

import {
  normalizeEntityKey,
  parseVendorEvents,
  resolveOccurredAt,
  vendorDedupeKey,
} from "./contract";

const event = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  entityType: "model",
  entityKey: "gpt-5",
  eventType: "release",
  title: "OpenAI 发布 GPT-5",
  summary: "推理能力提升。",
  occurredAt: "2026-10-26",
  ...over,
});

describe("parseVendorEvents", () => {
  it("合法载荷解析", () => {
    const r = parseVendorEvents(JSON.stringify({ events: [event()] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.events).toHaveLength(1);
      expect(r.data.dropped).toBe(0);
      expect(r.data.events[0].entityType).toBe("model");
    }
  });

  it("```json 围栏与前置解释文本可剥离", () => {
    const raw = `好的,结果如下:\n\`\`\`json\n${JSON.stringify({ events: [event()] })}\n\`\`\``;
    expect(parseVendorEvents(raw).ok).toBe(true);
  });

  it("超 3 条截断并计数 dropped(不整条判废)", () => {
    const r = parseVendorEvents(
      JSON.stringify({ events: [event(), event(), event(), event(), event()] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.events).toHaveLength(3);
      expect(r.data.dropped).toBe(2);
    }
  });

  it("空事件数组合法(纯观点文章)", () => {
    const r = parseVendorEvents('{"events":[]}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.events).toHaveLength(0);
  });

  it("非法枚举/缺标题/非 JSON → 错误串(交 chatJsonTask 重试)", () => {
    expect(parseVendorEvents(JSON.stringify({ events: [event({ eventType: "launch" })] })).ok).toBe(
      false,
    );
    expect(parseVendorEvents(JSON.stringify({ events: [event({ title: "" })] })).ok).toBe(false);
    expect(parseVendorEvents("not json").ok).toBe(false);
    expect(parseVendorEvents(JSON.stringify({ items: [] })).ok).toBe(false);
  });
});

describe("normalizeEntityKey", () => {
  it("小写/空格转连字符/去首尾空白", () => {
    expect(normalizeEntityKey("  GPT-5  Turbo ")).toBe("gpt-5-turbo");
    expect(normalizeEntityKey("DeepSeek V4")).toBe("deepseek-v4");
  });
});

describe("resolveOccurredAt", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const fallback = new Date("2026-10-20T00:00:00Z");

  it("合法日期原样(UTC 零点)", () => {
    expect(resolveOccurredAt("2026-10-26", fallback, now).toISOString()).toBe(
      "2026-10-26T00:00:00.000Z",
    );
  });

  it("晚于今天+1 天 / 早于 2000 年 / 非法日期 → 回退列表页日期", () => {
    expect(resolveOccurredAt("2099-01-01", fallback, now).toISOString()).toBe(
      fallback.toISOString(),
    );
    expect(resolveOccurredAt("1999-12-31", fallback, now).toISOString()).toBe(
      fallback.toISOString(),
    );
    expect(resolveOccurredAt("2026-02-31", fallback, now).toISOString()).toBe(
      fallback.toISOString(),
    );
  });

  it("null/缺失且无列表页日期 → 采集时间", () => {
    expect(resolveOccurredAt(null, null, now).toISOString()).toBe(now.toISOString());
    expect(resolveOccurredAt(undefined, null, now).toISOString()).toBe(now.toISOString());
  });
});

describe("vendorDedupeKey", () => {
  it("同输入稳定;URL 尾斜杠/跟踪参数归一后同键;entityKey 不同则不同键", () => {
    const a = vendorDedupeKey(
      "vendor-openai",
      "https://openai.com/index/gpt-5/?utm_source=x",
      "release",
      "gpt-5",
    );
    const b = vendorDedupeKey(
      "vendor-openai",
      "https://openai.com/index/gpt-5",
      "release",
      "gpt-5",
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(
      vendorDedupeKey("vendor-openai", "https://openai.com/index/gpt-5", "release", "gpt-5-mini"),
    ).not.toBe(a);
  });
});
