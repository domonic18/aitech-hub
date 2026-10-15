/**
 * 封面候选 HITL 契约单测(M31):interrupt 载荷解析(kind 防串线/形状缺损
 * 返 null)、resume 决策解析(批④:形状异常可见,工具体同 discard 清临时
 * 件)、resume 命令体构造。
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_COVER_CANDIDATES_TOOL,
  buildCoverResumeCommand,
  parseAgentCoverInterrupt,
  parseAgentCoverResume,
} from "./cover-tool";

const PAYLOAD = {
  kind: AGENT_COVER_CANDIDATES_TOOL,
  prompt: "科技感插画",
  token: "t",
  candidates: [{ id: "12", url: "/api/posts/cover-candidates/12/raw" }],
};

describe("parseAgentCoverInterrupt", () => {
  it("合法载荷原样解析", () => {
    expect(parseAgentCoverInterrupt(PAYLOAD)).toEqual(PAYLOAD);
  });

  it("kind 不符 / 形状缺损 / 非对象 → null(调用方落兜底卡)", () => {
    expect(parseAgentCoverInterrupt({ kind: "ask_user", question: "q" })).toBeNull();
    expect(parseAgentCoverInterrupt({ kind: AGENT_COVER_CANDIDATES_TOOL })).toBeNull();
    expect(
      parseAgentCoverInterrupt({ kind: AGENT_COVER_CANDIDATES_TOOL, prompt: "p", candidates: [] }),
    ).toBeNull();
    expect(
      parseAgentCoverInterrupt({
        kind: AGENT_COVER_CANDIDATES_TOOL,
        prompt: "p",
        candidates: [{ id: 1, url: "u" }], // id 非串
      }),
    ).toBeNull();
    expect(
      parseAgentCoverInterrupt({
        kind: AGENT_COVER_CANDIDATES_TOOL,
        prompt: "p",
        candidates: [{ id: "1", url: "u" }], // token 缺失(批④ 起)
      }),
    ).toBeNull();
    expect(parseAgentCoverInterrupt("text")).toBeNull();
    expect(parseAgentCoverInterrupt(null)).toBeNull();
  });
});

describe("parseAgentCoverResume", () => {
  it("adopt 带非空 candidateId;discard 不带", () => {
    expect(parseAgentCoverResume({ decision: "adopt", candidateId: "12" })).toEqual({
      decision: "adopt",
      candidateId: "12",
    });
    expect(parseAgentCoverResume({ decision: "discard" })).toEqual({ decision: "discard" });
  });

  it("形状异常一律 null(工具体同 discard 清临时件,不误入库)", () => {
    expect(parseAgentCoverResume({ decision: "adopt" })).toBeNull(); // 缺 candidateId
    expect(parseAgentCoverResume({ decision: "adopt", candidateId: "" })).toBeNull(); // 空 id
    expect(parseAgentCoverResume({ decision: "adopt", candidateId: 12 })).toBeNull(); // id 非串
    expect(parseAgentCoverResume({ decision: "unknown" })).toBeNull(); // 未知决策
    expect(parseAgentCoverResume("text")).toBeNull();
    expect(parseAgentCoverResume(null)).toBeNull();
  });
});

describe("buildCoverResumeCommand", () => {
  it("adopt 带 candidateId;discard 不带", () => {
    expect(buildCoverResumeCommand({ decision: "adopt", candidateId: "12" })).toEqual({
      resume: { decision: "adopt", candidateId: "12" },
    });
    expect(buildCoverResumeCommand({ decision: "discard" })).toEqual({
      resume: { decision: "discard" },
    });
  });
});
