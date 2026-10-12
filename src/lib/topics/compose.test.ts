/**
 * 专题合成纯函数单测(M26 批④,方案 §9):素材拼装(笔记优先/降级短结论+要点/
 * 批注注入/文章取样)/ 重合成保护判定 / 输出契约解析(合法/缺 JSON/结构不符/
 * 列帽截断)/ 未绑模型防线。LLM 调用与落稿不入单测(集成路径由真机验收覆盖)。
 */
import { describe, expect, it, vi } from "vitest";
import type { Topic, TopicItem } from "@prisma/client";

vi.mock("../ai/resolver", () => ({ resolveAiModel: async () => null }));

import { composeTopicDraft } from "./compose";
import {
  buildComposePrompt,
  buildMaterialSection,
  needsRecomposeConfirm,
  parseComposeResult,
  type ComposeMaterialBlock,
} from "./compose";

function tgBlock(partial: Partial<ComposeMaterialBlock>): ComposeMaterialBlock {
  return {
    kind: "telegram",
    title: "e2e 视频",
    blogger: "UP主A",
    note: null,
    aiNote: null,
    aiSummary: null,
    aiPoints: [],
    excerpt: null,
    contentSample: null,
    ...partial,
  };
}

describe("buildMaterialSection(素材拼装)", () => {
  it("笔记优先:有 aiNote 时输出解读笔记,批注紧随标题", () => {
    const s = buildMaterialSection([
      tgBlock({ note: "重点用第 2 点", aiNote: "## 背景与问题\n端侧模型拐点已到。" }),
    ]);
    expect(s).toContain("【素材1·视频】《e2e 视频》(博主:UP主A)");
    expect(s).toContain("人工批注:重点用第 2 点");
    expect(s).toContain("解读笔记:");
    expect(s).toContain("端侧模型拐点已到");
    expect(s).not.toContain("短结论");
  });

  it("降级拼装:无笔记时回退短结论+要点(存量素材口径)", () => {
    const s = buildMaterialSection([
      tgBlock({
        aiNote: null,
        aiSummary: "端侧成本过了拐点。",
        aiPoints: ["成本减半", "时延更低"],
      }),
    ]);
    expect(s).toContain("短结论:端侧成本过了拐点。");
    expect(s).toContain("- 成本减半");
    expect(s).toContain("- 时延更低");
    expect(s).not.toContain("解读笔记");
  });

  it("文章块:标题/摘要/正文节选(取样截断在上游 composeTopicDraft)", () => {
    const s = buildMaterialSection([
      {
        kind: "post",
        title: "旧文",
        blogger: null,
        note: null,
        aiNote: null,
        aiSummary: null,
        aiPoints: [],
        excerpt: "一句话摘要",
        contentSample: "正文片段",
      },
    ]);
    expect(s).toContain("【素材1·文章】《旧文》");
    expect(s).toContain("摘要:一句话摘要");
    expect(s).toContain("正文节选:\n正文片段");
  });

  it("多素材编号递增且双换行分隔", () => {
    const s = buildMaterialSection([tgBlock({ title: "A" }), tgBlock({ title: "B" })]);
    expect(s).toContain("【素材1·视频】《A》");
    expect(s).toContain("【素材2·视频】《B》");
  });

  it("空素材返回空串", () => {
    expect(buildMaterialSection([])).toBe("");
  });
});

describe("needsRecomposeConfirm(重合成保护判定)", () => {
  const composedAt = new Date("2026-10-13T10:00:00Z");
  const topic = { linkedPostId: BigInt(1), composedAt };

  it("无关联/关联行缺失 → false(走新建)", () => {
    expect(needsRecomposeConfirm({ linkedPostId: null, composedAt }, null)).toBe(false);
    expect(needsRecomposeConfirm(topic, null)).toBe(false);
  });

  it("关联文档软删 → false(弃锚新建)", () => {
    expect(needsRecomposeConfirm(topic, { status: "deleted", updatedAt: new Date() })).toBe(false);
  });

  it("合成后未被编辑(updatedAt ≤ composedAt)→ false", () => {
    expect(needsRecomposeConfirm(topic, { status: "draft", updatedAt: composedAt })).toBe(false);
  });

  it("合成后被人工编辑(updatedAt > composedAt)→ true", () => {
    expect(
      needsRecomposeConfirm(topic, {
        status: "draft",
        updatedAt: new Date("2026-10-13T11:00:00Z"),
      }),
    ).toBe(true);
  });

  it("人工关联但从未合成过(composedAt=null)→ true(覆盖即破坏)", () => {
    expect(
      needsRecomposeConfirm(
        { linkedPostId: BigInt(1), composedAt: null },
        { status: "published", updatedAt: new Date("2026-01-01T00:00:00Z") },
      ),
    ).toBe(true);
  });
});

describe("parseComposeResult(输出契约)", () => {
  it("合法 JSON:三字段透传", () => {
    const r = parseComposeResult(
      '```json\n{"title":"端侧模型拐点","excerpt":"一句话。","contentMd":"## 一节\\n' +
        "x".repeat(120) +
        '"}\n```',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.title).toBe("端侧模型拐点");
      expect(r.data.excerpt).toBe("一句话。");
    }
  });

  it("无 JSON / 结构不符 → ok:false 带错误串", () => {
    expect(parseComposeResult("没有结构化输出").ok).toBe(false);
    expect(parseComposeResult('{"title":"只有标题"}').ok).toBe(false);
    const bad = parseComposeResult('{"title":"","excerpt":"","contentMd":"短"}');
    expect(bad.ok).toBe(false);
  });

  it("超长截断到列帽(title 500/excerpt 500)不整条判废", () => {
    const r = parseComposeResult(
      JSON.stringify({
        title: "t".repeat(600),
        excerpt: "e".repeat(600),
        contentMd: "c".repeat(200),
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.title.length).toBe(500);
      expect(r.data.excerpt.length).toBe(500);
    }
  });
});

describe("composeTopicDraft(未绑模型防线)", () => {
  it("compose 角色未绑定 → AiAdminError(disabled),先于任何 DB 触达", async () => {
    const bare = {
      id: BigInt(1),
      title: "t",
      positioning: null,
      status: "collecting",
      linkedPostId: null,
      composedAt: null,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [] as TopicItem[],
    } as unknown as Topic & { items: TopicItem[] };
    await expect(composeTopicDraft(bare)).rejects.toMatchObject({
      code: "disabled",
      message: expect.stringContaining("专题合成"),
    });
  });
});

describe("buildComposePrompt(输入拼装)", () => {
  it("含定位/素材区/近期标题清单;定位缺省有占位", () => {
    const p = buildComposePrompt({
      topicTitle: "端侧 AI 拐点",
      positioning: "面向开发者,口语化",
      materialsSection: "【素材1·视频】《A》",
      recentTitles: ["已发文一", "已发文二"],
    });
    expect(p.user).toContain("专题:端侧 AI 拐点");
    expect(p.user).toContain("面向开发者,口语化");
    expect(p.user).toContain("【素材1·视频】《A》");
    expect(p.user).toContain("- 已发文一");
    expect(p.system).toContain("2000 字左右");
    const noPos = buildComposePrompt({
      topicTitle: "t",
      positioning: null,
      materialsSection: "m",
      recentTitles: [],
    });
    expect(noPos.user).toContain("(未填写,按素材自然组织)");
    expect(noPos.user).not.toContain("近期已发布文章标题");
  });
});
