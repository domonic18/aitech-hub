/**
 * hitl 契约单测(零依赖纯函数):interrupt 载荷解析(kind 收口/字段缺损拒)、
 * resume 命令体构造——前后端共用形状的唯一真相源。
 */
import { describe, expect, it } from "vitest";

import { AGENT_ASK_USER_TOOL, buildAskUserResumeCommand, parseAgentAskUserInterrupt } from "./hitl";

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
