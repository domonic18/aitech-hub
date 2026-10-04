/**
 * 解读结果契约单测:围栏/噪声容错解析、字符串内花括号感知、
 * schema 列帽(topic 50/summary 1000/points ≤3×120)、
 * prompt 构造(转写有无两形态、标签拼接)。
 */
import { describe, expect, it } from "vitest";

import { buildInterpretPrompt, parseInterpretResult } from "./interpret-result";

const GOOD = {
  topic: "多模态大模型进展",
  summary: "这条视频讲了最新多模态模型的评测结果与落地场景。",
  points: ["评测覆盖 5 个基准", "开源模型追平闭源"],
};

describe("parseInterpretResult", () => {
  it("纯 JSON / ```json 围栏 / 前后噪声都能取到对象", () => {
    expect(parseInterpretResult(JSON.stringify(GOOD))).toEqual({ ok: true, data: GOOD });

    const fenced = "```json\n" + JSON.stringify(GOOD, null, 2) + "\n```";
    expect(parseInterpretResult(fenced)).toEqual({ ok: true, data: GOOD });

    const noisy = `好的,以下是解读结果:\n${JSON.stringify(GOOD)}\n希望有帮助`;
    const r = parseInterpretResult(noisy);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual(GOOD);
  });

  it("字符串值内含花括号/引号不破坏平衡扫描", () => {
    const tricky = JSON.stringify({ ...GOOD, topic: '花括号 { 与 " 引号' });
    const r = parseInterpretResult(`说明:${tricky}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.topic).toBe('花括号 { 与 " 引号');
  });

  it("trim 生效;字段缺失/超列帽/points 超量 → not ok", () => {
    const padded = parseInterpretResult(JSON.stringify({ ...GOOD, topic: `  ${GOOD.topic}  ` }));
    expect(padded.ok).toBe(true);
    if (padded.ok) expect(padded.data.topic).toBe(GOOD.topic);

    expect(parseInterpretResult(JSON.stringify({ summary: "s", points: [] })).ok).toBe(false);
    expect(parseInterpretResult(JSON.stringify({ ...GOOD, summary: "长".repeat(1001) })).ok).toBe(
      false,
    );
    expect(parseInterpretResult(JSON.stringify({ ...GOOD, points: ["1", "2", "3", "4"] })).ok).toBe(
      false,
    );
    expect(parseInterpretResult(JSON.stringify({ ...GOOD, points: ["长".repeat(121)] })).ok).toBe(
      false,
    );
  });

  it("null 字面量 / 无 JSON / 坏 JSON → not ok 且带错误串,永不 throw", () => {
    expect(parseInterpretResult("null").ok).toBe(false);
    expect(parseInterpretResult("没有任何对象").ok).toBe(false);
    const bad = parseInterpretResult("{topic: 没有引号}");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("JSON 解析失败");
  });
});

describe("buildInterpretPrompt", () => {
  it("有转写:user 含标题/标签/文案/转写全文;system 不提降级", () => {
    const p = buildInterpretPrompt({
      title: "视频标题",
      caption: "口播文案第一行",
      topicTags: ["AI", "大模型"],
      transcript: "大家好,今天聊一聊……",
    });
    expect(p.system).toContain("JSON");
    expect(p.system).not.toContain("(基于文案)");
    expect(p.user).toContain("标题:视频标题");
    expect(p.user).toContain("话题标签:AI、大模型");
    expect(p.user).toContain("口播文案:口播文案第一行");
    expect(p.user).toContain("——视频转写全文——");
    expect(p.user).toContain("大家好,今天聊一聊……");
  });

  it("无转写:system 注明基于文案概括;字段缺失回退 (无)", () => {
    const p = buildInterpretPrompt({ title: null, caption: null, topicTags: [], transcript: null });
    expect(p.system).toContain("(基于文案)");
    expect(p.user).not.toContain("转写");
    expect(p.user).toContain("标题:(无)");
    expect(p.user).toContain("口播文案:(无)");
  });
});
