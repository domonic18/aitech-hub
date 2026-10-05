/**
 * 文字摘要契约单测(M12 批③;批⑥ v2):summary ≤120/points 2-4/keywords 3-5
 * 结构钳制(下限硬卡,上限超量截断救底 2026-10-05)、泛词过滤(「AI」类禁令,
 * 滤光判不符)、JSON 提炼容错(围栏/前后噪声)与 prompt 双分支(有/无原文粗提取)。
 */
import { describe, expect, it } from "vitest";

import { buildSummarizePrompt, parseSummarizeResult } from "./summarize-result";

const GOOD = JSON.stringify({
  summary: "中心思想",
  points: ["要点一", "要点二"],
  keywords: ["大模型", "开源", "评测"],
});

describe("parseSummarizeResult", () => {
  it("合法 JSON → 结构化结果(summary+points+keywords)", () => {
    expect(parseSummarizeResult(GOOD)).toEqual({
      ok: true,
      data: {
        summary: "中心思想",
        points: ["要点一", "要点二"],
        keywords: ["大模型", "开源", "评测"],
      },
    });
  });

  it("剥代码围栏与前后噪声取平衡片段;字段 trim", () => {
    const raw = `好的,以下是结果:\n\`\`\`json\n{"summary":" 概括 ","points":[" a ","b "],"keywords":[" x ","y","z"]}\n\`\`\`\n以上。`;
    expect(parseSummarizeResult(raw)).toEqual({
      ok: true,
      data: { summary: "概括", points: ["a", "b"], keywords: ["x", "y", "z"] },
    });
  });

  it("keywords 不足下限(2 个)→ 仍结构不符;超量(6 个)→ 截到 5 救底(2026-10-05)", () => {
    expect(
      parseSummarizeResult(
        JSON.stringify({ summary: "x", points: ["a", "b"], keywords: ["a", "b"] }),
      ).ok,
    ).toBe(false);
    expect(
      parseSummarizeResult(
        JSON.stringify({
          summary: "x",
          points: ["a", "b"],
          keywords: ["a", "b", "c", "d", "e", "f"],
        }),
      ),
    ).toEqual({
      ok: true,
      data: { summary: "x", points: ["a", "b"], keywords: ["a", "b", "c", "d", "e"] },
    });
  });

  it("points 不足下限(1 条)→ 仍结构不符;超量(5 条)→ 截到 4 救底(2026-10-05)", () => {
    expect(
      parseSummarizeResult(
        JSON.stringify({ summary: "x", points: ["a"], keywords: ["a", "b", "c"] }),
      ).ok,
    ).toBe(false);
    expect(
      parseSummarizeResult(
        JSON.stringify({
          summary: "x",
          points: ["a", "b", "c", "d", "e"],
          keywords: ["a", "b", "c"],
        }),
      ),
    ).toEqual({
      ok: true,
      data: { summary: "x", points: ["a", "b", "c", "d"], keywords: ["a", "b", "c"] },
    });
  });

  it("keywords 超量混泛词 → 先滤泛词再截 5,保住滤后的具体词", () => {
    expect(
      parseSummarizeResult(
        JSON.stringify({
          summary: "x",
          points: ["a", "b"],
          keywords: ["AI", "文生视频", "人工智能", "Sora", "开源", "评测", "算力"],
        }),
      ),
    ).toEqual({
      ok: true,
      data: {
        summary: "x",
        points: ["a", "b"],
        keywords: ["文生视频", "Sora", "开源", "评测", "算力"],
      },
    });
  });

  it("summary 超 120 字 → 结构不符", () => {
    expect(
      parseSummarizeResult(
        JSON.stringify({
          summary: "长".repeat(121),
          points: ["a", "b"],
          keywords: ["a", "b", "c"],
        }),
      ).ok,
    ).toBe(false);
  });

  it("泛词过滤(批⑥):AI/人工智能(大小写/混入泛词)被剔除,保具体词", () => {
    expect(
      parseSummarizeResult(
        JSON.stringify({
          summary: "x",
          points: ["a", "b"],
          keywords: ["AI", "人工智能", "AI眼镜", "具身智能", "Figure"],
        }),
      ),
    ).toEqual({
      ok: true,
      data: { summary: "x", points: ["a", "b"], keywords: ["AI眼镜", "具身智能", "Figure"] },
    });
  });

  it("keywords 全为泛词 → 结构不符(错误串带禁令,借解析重试反馈模型)", () => {
    const r = parseSummarizeResult(
      JSON.stringify({ summary: "x", points: ["a", "b"], keywords: ["AI", "人工智能", "ai"] }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("泛词");
  });

  it("无 JSON 对象/坏 JSON → 错误串,永不 throw", () => {
    expect(parseSummarizeResult("完全没有结构化输出").ok).toBe(false);
    expect(parseSummarizeResult("{broken").ok).toBe(false);
  });
});

describe("buildSummarizePrompt", () => {
  it("有原文粗提取 → user 带正文段;否则仅标题+摘要(降级分支 system 提示)", () => {
    const withContent = buildSummarizePrompt({
      title: "标题",
      summary: "摘要",
      content: "正文粗提取",
    });
    expect(withContent.user).toContain("——正文粗提取(可能截断)——\n正文粗提取");
    expect(withContent.system).toContain("JSON");
    // 批⑥:prompt 明令禁泛词
    expect(withContent.system).toContain("人工智能");
    // M14:外刊渠道要求外语输入翻译成简体中文输出
    expect(withContent.system).toContain("翻译成简体中文");

    const degraded = buildSummarizePrompt({ title: "标题", summary: "摘要", content: null });
    expect(degraded.user).not.toContain("正文粗提取");
    expect(degraded.system).toContain("仅基于标题与摘要");
    expect(degraded.system).toContain("翻译成简体中文");
  });
});
