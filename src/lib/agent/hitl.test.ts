/**
 * hitl 契约单测(零依赖纯函数):interrupt 载荷解析(kind 收口/字段缺损拒)、
 * resume 命令体构造——前后端共用形状的唯一真相源。
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_ASK_USER_TOOL,
  buildAskUserResumeCommand,
  normalizeAskUserOptions,
  parseAgentAskUserInterrupt,
} from "./hitl";

describe("parseAgentAskUserInterrupt", () => {
  it("合法载荷(kind=ask_user)解析出问题与选项", () => {
    const out = parseAgentAskUserInterrupt({
      kind: "ask_user",
      question: "想反馈什么?",
      options: ["报问题", "提建议"],
    });
    expect(out).toEqual({
      kind: "ask_user",
      question: "想反馈什么?",
      options: ["报问题", "提建议"],
    });
  });

  it("无选项载荷 options 缺省(纯自由文本卡)", () => {
    expect(parseAgentAskUserInterrupt({ kind: "ask_user", question: "诉求是什么?" })).toEqual({
      kind: "ask_user",
      question: "诉求是什么?",
    });
  });

  it("kind 不符/问题缺失/非对象安全返 null", () => {
    expect(parseAgentAskUserInterrupt({ kind: "other", question: "x" })).toBeNull();
    expect(parseAgentAskUserInterrupt({ kind: "ask_user", question: "" })).toBeNull();
    expect(parseAgentAskUserInterrupt({ kind: "ask_user" })).toBeNull();
    expect(parseAgentAskUserInterrupt(null)).toBeNull();
    expect(parseAgentAskUserInterrupt("ask_user")).toBeNull();
    expect(parseAgentAskUserInterrupt(undefined)).toBeNull();
  });

  it("options 非字符串项过滤;全空则缺省", () => {
    expect(
      parseAgentAskUserInterrupt({ kind: "ask_user", question: "q", options: ["a", 3, null, "b"] }),
    ).toEqual({ kind: "ask_user", question: "q", options: ["a", "b"] });
    expect(
      parseAgentAskUserInterrupt({ kind: "ask_user", question: "q", options: [1, 2] }),
    ).toEqual({ kind: "ask_user", question: "q" });
  });
});

describe("buildAskUserResumeCommand", () => {
  it("自由文本与点选两种 resume 体", () => {
    expect(buildAskUserResumeCommand({ message: "忘了说,补一句" })).toEqual({
      resume: { message: "忘了说,补一句" },
    });
    expect(buildAskUserResumeCommand({ message: "报问题", option: "报问题" })).toEqual({
      resume: { message: "报问题", option: "报问题" },
    });
  });

  it("工具名常量与 kind 同源(防两处字面量漂移)", () => {
    expect(AGENT_ASK_USER_TOOL).toBe("ask_user");
  });
});

describe("normalizeAskUserOptions(M31 弱模型漂移归一)", () => {
  it("checkpoint 实证形态:对象数组 [{content}] 抽字段成 string[]", () => {
    expect(normalizeAskUserOptions([{ content: "极简科技风" }, { content: "对比叙事风" }])).toEqual(
      ["极简科技风", "对比叙事风"],
    );
  });

  it("对象数组别名字段(label/text/value/title/name/option)同样命中", () => {
    expect(normalizeAskUserOptions([{ label: "A" }, { text: "B" }])).toEqual(["A", "B"]);
    expect(normalizeAskUserOptions([{ value: "C" }, { title: "D" }])).toEqual(["C", "D"]);
    expect(normalizeAskUserOptions([{ name: "E" }, { option: "F" }])).toEqual(["E", "F"]);
  });

  it("JSON 串整体解析后递归;分隔符串按分号/换行切", () => {
    expect(normalizeAskUserOptions('[{"content":"甲"},{"content":"乙"}]')).toEqual(["甲", "乙"]);
    expect(normalizeAskUserOptions('["甲","乙"]')).toEqual(["甲", "乙"]);
    expect(normalizeAskUserOptions("甲;乙\n丙")).toEqual(["甲", "乙", "丙"]);
  });

  it("有效项不足 2 → undefined(降级无选项提问);空串/非数组原样交 zod", () => {
    expect(normalizeAskUserOptions([{ content: "只有一条" }])).toBeUndefined();
    expect(normalizeAskUserOptions("仅一句无分隔")).toBeUndefined();
    expect(normalizeAskUserOptions("")).toBeUndefined();
    expect(normalizeAskUserOptions([{ nope: 1 }, { content: "" }])).toBeUndefined();
    expect(normalizeAskUserOptions(42)).toBe(42);
  });

  it("合法 string[] 照常通过:trim、截 100、超 4 取前 4", () => {
    const long = "字".repeat(120);
    const out = normalizeAskUserOptions([` ${long} `, "乙", "丙", "丁", "戊"]);
    expect(out).toEqual(["字".repeat(100), "乙", "丙", "丁"]);
  });
});
