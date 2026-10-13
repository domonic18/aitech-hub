/**
 * 改稿提案应用器单测(M27 批⑧-d):定位三态(精确唯一/多处命中歧义 miss/
 * 模糊兜底过门槛/模糊不过门槛 miss)、merge 只落接受块 + 区间冲突丢弃后者、
 * 未定位不阻塞其他块。
 */
import { describe, expect, it } from "vitest";

import { FUZZY_THRESHOLD, locateProposals, mergeProposals } from "./proposal-apply";

const DOC = [
  "## 博主是谁",
  "张三是 AI 领域的资深创作者,深耕大模型方向。",
  "",
  "## 视频讲了什么",
  "本条视频讲清楚了推理成本的下降趋势。",
].join("\n");

describe("locateProposals", () => {
  it("精确唯一命中:status=exact,区间指向原文", () => {
    const chunks = locateProposals(DOC, [
      { oldString: "深耕大模型方向", newString: "深耕大模型落地方向" },
    ]);
    expect(chunks[0]?.status).toBe("exact");
    expect(DOC.slice(chunks[0]!.start, chunks[0]!.end)).toBe("深耕大模型方向");
  });

  it("多处命中视为歧义:miss(模型应加长 oldString 消歧)", () => {
    const doc = "重复词重复词结尾";
    const chunks = locateProposals(doc, [{ oldString: "重复词", newString: "x" }]);
    expect(chunks[0]?.status).toBe("miss");
    expect(chunks[0]!.start).toBe(-1);
  });

  it("模糊兜底:轻微笔误(标点差异)过相似度门槛,status=fuzzy", () => {
    // 原文用中文逗号,oldString 用英文逗号 + 一字之差:dmp 应命中同区域
    const chunks = locateProposals(DOC, [
      { oldString: "张三是 AI 领域的资深创作者. 深耕大模型方向", newString: "替换后" },
    ]);
    expect(chunks[0]?.status).toBe("fuzzy");
    if (chunks[0]!.status === "fuzzy") {
      expect(DOC.slice(chunks[0]!.start, chunks[0]!.end)).toContain("张三是");
    }
  });

  it("风马牛不相及:模糊命中相似度低于门槛 → miss", () => {
    const chunks = locateProposals(DOC, [
      { oldString: "量子纠缠在超导电路中的相位噪声建模", newString: "x" },
    ]);
    expect(chunks[0]?.status).toBe("miss");
  });

  it("混批:未定位块不阻塞其他块(状态各自独立)", () => {
    const chunks = locateProposals(DOC, [
      { oldString: "本条视频讲清楚了", newString: "这条视频讲清楚了" },
      { oldString: "不存在的句子", newString: "x" },
      { oldString: "推理成本的下降趋势", newString: "推理成本的下降速度" },
    ]);
    expect(chunks.map((c) => c.status)).toEqual(["exact", "miss", "exact"]);
  });
});

describe("mergeProposals", () => {
  const chunks = locateProposals(DOC, [
    { oldString: "深耕大模型方向", newString: "深耕大模型落地方向", note: "①" },
    { oldString: "推理成本的下降趋势", newString: "推理成本的下降速度", note: "②" },
  ]);

  it("全部接受:两块依序落位,其余原文保留", () => {
    const merged = mergeProposals(DOC, chunks, new Set([0, 1]));
    expect(merged).toContain("深耕大模型落地方向");
    expect(merged).toContain("推理成本的下降速度");
    expect(merged).toContain("## 博主是谁");
    expect(merged).not.toContain("深耕大模型方向。");
  });

  it("只接受部分:拒绝块保持原文", () => {
    const merged = mergeProposals(DOC, chunks, new Set([0]));
    expect(merged).toContain("深耕大模型落地方向");
    expect(merged).toContain("推理成本的下降趋势"); // 原文未动
    expect(merged).not.toContain("推理成本的下降速度");
  });

  it("接受集为空:原文原样返回", () => {
    expect(mergeProposals(DOC, chunks, new Set())).toBe(DOC);
  });

  it("未定位块即使进了接受集也不落位(miss 无区间)", () => {
    const mixed = locateProposals(DOC, [
      { oldString: "不存在的句子", newString: "幻觉文本" },
      { oldString: "深耕大模型方向", newString: "深耕落地" },
    ]);
    const merged = mergeProposals(DOC, mixed, new Set([0, 1]));
    expect(merged).not.toContain("幻觉文本");
    expect(merged).toContain("深耕落地");
  });

  it("区间冲突(接受块互相重叠):后者丢弃,先到先得", () => {
    // 手工构造重叠区间(exact 定位不可构造重叠,直接注入 chunk 形状)
    const overlapped = [
      { index: 0, oldString: "a", newString: "A", status: "exact" as const, start: 0, end: 10 },
      { index: 1, oldString: "b", newString: "B", status: "exact" as const, start: 5, end: 12 },
    ];
    const merged = mergeProposals("0123456789ABCDEF", overlapped, new Set([0, 1]));
    // chunk0 [0,10)→"A" 落位;chunk1 [5,12) 与之重叠被丢弃,原文 [10,) 保留
    expect(merged).toBe("A" + "0123456789ABCDEF".slice(10));
  });

  it("相似度门槛为 0.6(契约常量收口)", () => {
    expect(FUZZY_THRESHOLD).toBe(0.6);
  });
});
