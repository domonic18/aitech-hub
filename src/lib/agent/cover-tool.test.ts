/**
 * 封面候选 HITL 契约单测(M31):interrupt 载荷解析(kind 防串线/形状缺损
 * 返 null)、resume 命令体构造。
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_COVER_CANDIDATES_TOOL,
  buildCoverResumeCommand,
  parseAgentCoverInterrupt,
} from "./cover-tool";

const PAYLOAD = {
  kind: AGENT_COVER_CANDIDATES_TOOL,
  prompt: "科技感插画",
  candidates: [{ id: "12", url: "/api/posts/cover-candidates/12/raw?token=t" }],
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
    expect(parseAgentCoverInterrupt("text")).toBeNull();
    expect(parseAgentCoverInterrupt(null)).toBeNull();
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
