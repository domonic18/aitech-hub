/**
 * propose_edits 契约单测(M27 批⑧-c,零依赖):interrupt 载荷解析(edits 档/
 * rewrite 档/形状缺损返 null/kind 不符返 null)与 resume 命令体构造。
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_PROPOSE_EDITS_TOOL,
  buildProposeEditsResumeCommand,
  parseProposeEditsInterrupt,
} from "./edit-proposal";

describe("parseProposeEditsInterrupt", () => {
  it("edits 档:块列表透传,空 note 字段剔除", () => {
    expect(
      parseProposeEditsInterrupt({
        kind: AGENT_PROPOSE_EDITS_TOOL,
        mode: "edits",
        note: "展开第二段",
        edits: [
          { oldString: "a", newString: "b", note: "补背景" },
          { oldString: "c", newString: "d", note: "" },
        ],
      }),
    ).toEqual({
      kind: "propose_edits",
      mode: "edits",
      note: "展开第二段",
      edits: [
        { oldString: "a", newString: "b", note: "补背景" },
        { oldString: "c", newString: "d" },
      ],
    });
  });

  it("rewrite 档:contentMd 透传", () => {
    expect(
      parseProposeEditsInterrupt({
        kind: AGENT_PROPOSE_EDITS_TOOL,
        mode: "rewrite",
        note: "整档按公众号风重写",
        contentMd: "# 新全文",
      }),
    ).toEqual({
      kind: "propose_edits",
      mode: "rewrite",
      note: "整档按公众号风重写",
      contentMd: "# 新全文",
    });
  });

  it("形状缺损/kind 不符一律 null(分发落其他卡)", () => {
    expect(parseProposeEditsInterrupt(null)).toBeNull();
    expect(parseProposeEditsInterrupt("junk")).toBeNull();
    expect(parseProposeEditsInterrupt({ kind: "ask_user", question: "q" })).toBeNull();
    expect(
      parseProposeEditsInterrupt({ kind: "propose_edits", mode: "other", note: "n" }),
    ).toBeNull();
    expect(
      parseProposeEditsInterrupt({ kind: "propose_edits", mode: "edits", note: "n" }),
    ).toBeNull(); // edits 缺失
    expect(
      parseProposeEditsInterrupt({
        kind: "propose_edits",
        mode: "edits",
        note: "n",
        edits: [{ oldString: "", newString: "b" }],
      }),
    ).toBeNull(); // oldString 空
    expect(
      parseProposeEditsInterrupt({
        kind: "propose_edits",
        mode: "edits",
        note: "n",
        edits: [{ oldString: "a" }],
      }),
    ).toBeNull(); // newString 缺失
    expect(
      parseProposeEditsInterrupt({ kind: "propose_edits", mode: "rewrite", note: "n" }),
    ).toBeNull();
  });
});

describe("buildProposeEditsResumeCommand", () => {
  it("resume 命令体形状 {resume:{kind,decision,...}}——kind 由构造器统一注入", () => {
    expect(buildProposeEditsResumeCommand({ decision: "unavailable" })).toEqual({
      resume: { kind: "propose_edits", decision: "unavailable" },
    });
    expect(
      buildProposeEditsResumeCommand({ decision: "partial", applied: 2, comment: "第二块再想想" }),
    ).toEqual({
      resume: { kind: "propose_edits", decision: "partial", applied: 2, comment: "第二块再想想" },
    });
  });
});
