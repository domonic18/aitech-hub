/**
 * 解读笔记模块单测(M26 批②,方案 §4):输出契约解析(围栏/噪声容错、长度
 * 护栏)、prompt 构造(四节模板 + JSON 包裹)、job 级重试与 null 降级。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chatTaskMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ note: "笔记" })),
);
vi.mock("./chat-json-task", () => ({ chatJsonTask: chatTaskMock }));

import { buildInterpretNotePrompt, parseInterpretNote, runInterpretNote } from "./interpret-note";
import type { ResolvedAiModel } from "./resolver";

const MODEL = {
  id: 1,
  name: "m",
  protocol: "openai",
  baseUrl: "https://llm.test/v1",
  modelId: "deepseek-chat",
  apiKey: "sk",
  timeoutSec: 60,
  concurrency: 1,
  supportsVision: false,
} as ResolvedAiModel;

const GOOD_NOTE = "## 背景与问题\n" + "这是笔记正文。".repeat(60); // >300 字过契约底线

describe("parseInterpretNote", () => {
  it("纯 JSON / ```json 围栏 / 前后噪声都能取到 note 字段", () => {
    const raw = JSON.stringify({ note: GOOD_NOTE });
    expect(parseInterpretNote(raw)).toEqual({ ok: true, data: { note: GOOD_NOTE } });

    const fenced = "```json\n" + JSON.stringify({ note: GOOD_NOTE }, null, 2) + "\n```";
    expect(parseInterpretNote(fenced).ok).toBe(true);

    const noisy = `好的,以下是解读笔记:\n${JSON.stringify({ note: GOOD_NOTE })}\n希望有帮助`;
    const r = parseInterpretNote(noisy);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.note).toBe(GOOD_NOTE);
  });

  it("trim 生效;缺字段 / 过短(<300)/ 超长(>4000)→ not ok", () => {
    const padded = parseInterpretNote(JSON.stringify({ note: `  ${GOOD_NOTE}  ` }));
    expect(padded.ok).toBe(true);
    if (padded.ok) expect(padded.data.note).toBe(GOOD_NOTE);

    expect(parseInterpretNote(JSON.stringify({})).ok).toBe(false);
    expect(parseInterpretNote(JSON.stringify({ note: "太短" })).ok).toBe(false);
    expect(parseInterpretNote(JSON.stringify({ note: "长".repeat(4001) })).ok).toBe(false);
  });

  it("null 字面量 / 无 JSON / 坏 JSON → not ok 且带错误串,永不 throw", () => {
    expect(parseInterpretNote("null").ok).toBe(false);
    expect(parseInterpretNote("没有对象").ok).toBe(false);
    const bad = parseInterpretNote("{note: 没有引号}");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("JSON 解析失败");
  });
});

describe("buildInterpretNotePrompt", () => {
  it("system 含四节模板与 JSON 输出要求;user 含标题/文案/转写全文,null 回退 (无)", () => {
    const p = buildInterpretNotePrompt({
      title: "视频标题",
      caption: "口播文案",
      transcript: "转写全文内容",
    });
    expect(p.system).toContain("解读笔记");
    expect(p.system).toContain("背景与问题");
    expect(p.system).toContain("核心要点");
    expect(p.system).toContain("做法与配置");
    expect(p.system).toContain("适用人群与局限");
    expect(p.system).toContain("JSON");
    expect(p.system).toContain("不编造");
    expect(p.user).toContain("标题:视频标题");
    expect(p.user).toContain("口播文案:口播文案");
    expect(p.user).toContain("——视频转写全文——");
    expect(p.user).toContain("转写全文内容");
  });

  it("标题/文案缺失回退 (无)", () => {
    const p = buildInterpretNotePrompt({ title: null, caption: null, transcript: "t" });
    expect(p.user).toContain("标题:(无)");
    expect(p.user).toContain("口播文案:(无)");
  });
});

describe("runInterpretNote(job 级重试与降级)", () => {
  beforeEach(() => {
    chatTaskMock.mockResolvedValue({ note: GOOD_NOTE });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("成功:透传 system/user/usage 角色与放大后的输出预算", async () => {
    const r = await runInterpretNote(MODEL, { title: "t", caption: "c", transcript: "全" });
    expect(r).toEqual({ note: GOOD_NOTE, error: null });
    expect(chatTaskMock).toHaveBeenCalledTimes(1);
    const [model, parse, system, user, role, opts] = chatTaskMock.mock.calls[0] as [
      ResolvedAiModel,
      (raw: string) => unknown,
      string,
      string,
      string,
      { maxTokens?: number },
    ];
    expect(model).toBe(MODEL);
    expect(parse(JSON.stringify({ note: GOOD_NOTE }))).toEqual({
      ok: true,
      data: { note: GOOD_NOTE },
    });
    expect(system).toContain("解读笔记");
    expect(user).toContain("——视频转写全文——");
    expect(role).toBe("interpret");
    expect(opts).toEqual({ maxTokens: 4000 });
  });

  it("首败重试恰一次,二次成功仍产笔记", async () => {
    chatTaskMock.mockRejectedValueOnce(new Error("网关抖动"));
    const r = await runInterpretNote(MODEL, { title: "t", caption: "c", transcript: "全" });
    expect(r).toEqual({ note: GOOD_NOTE, error: null });
    expect(chatTaskMock).toHaveBeenCalledTimes(2);
  });

  it("两连败 → note=null 不上抛,错误串随降级返回", async () => {
    chatTaskMock.mockRejectedValue(new Error("限流"));
    const r = await runInterpretNote(MODEL, { title: "t", caption: "c", transcript: "全" });
    expect(r.note).toBeNull();
    expect(r.error).toContain("限流");
    expect(chatTaskMock).toHaveBeenCalledTimes(2);
  });
});
