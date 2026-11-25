/**
 * 采集共性层单测:单位识别(标签/表级/模态)、行价基准策略、表头列语义框架。
 * 用例形态全部来自四源实探口径(百炼表头、硅基流动单价格行、方舟表头、
 * 词元所模态 chip),迁移前后行为等价由各源 fixture 测试钉死。
 */
import { describe, expect, it } from "vitest";

import { pickResolutionBase, pickTokenBase } from "./base-price";
import { BAILIAN_COLUMN_RULES, roleByKeywords } from "./columns";
import { unitForModality, unitOfLabelText, unitOfTableLike } from "./units";

describe("unitOfLabelText(单价格行/标签)", () => {
  it.each([
    ["0.02元/张", "per_image"],
    ["每张 0.4元", "per_image"],
    ["每图片 ¥0.21", "per_image"],
    ["3.5元/秒", "per_second"],
    ["每秒 0.6 元", "per_second"],
    ["1元/分钟", "per_minute"],
    ["每分钟", "per_minute"],
    ["每百万Token", "per_1m_tokens"],
    ["元/Mtoken", "per_1m_tokens"],
    ["元/M token", "per_1m_tokens"],
    ["每千Token", "per_1k_tokens"],
    ["元/Ktoken", "per_1k_tokens"],
  ])("%s → %s", (text, unit) => {
    expect(unitOfLabelText(text)).toBe(unit);
  });

  it("认不出 → null(单位闸)", () => {
    expect(unitOfLabelText("元/次")).toBeNull();
    expect(unitOfLabelText("面议")).toBeNull();
  });
});

describe("unitOfTableLike(表级)", () => {
  it("表头张/秒优先,其次首行格,最后表头 token(百炼口径序)", () => {
    expect(unitOfTableLike(["模型 ID", "输入单价(元/张)"], ["0.2元"])).toBe("per_image");
    expect(unitOfTableLike(["模型 ID", "输出单价(每秒)"], ["0.5元"])).toBe("per_second");
    expect(unitOfTableLike(["模型", "价格"], ["0.02元/张 起"])).toBe("per_image");
    expect(unitOfTableLike(["模型", "输入单价(每百万Token)"], ["1元"])).toBe("per_1m_tokens");
  });

  it("headers-only 源(方舟)传空数组", () => {
    expect(unitOfTableLike(["模型", "输入价格(元/Mtoken)", "输出价格(元/Mtoken)"], [])).toBe(
      "per_1m_tokens",
    );
    expect(unitOfTableLike(["模型", "生成价格(元/分钟)"], [])).toBe("per_minute");
  });

  it("认不出 → null 整表跳过", () => {
    expect(unitOfTableLike(["模型", "调用费用(元/次)"], ["0.01元"])).toBeNull();
  });
});

describe("unitForModality(模态→单位,词元所口径)", () => {
  it("文本→百万 token,视频→按秒;音频/图片未实证 → null", () => {
    expect(unitForModality("文本")).toBe("per_1m_tokens");
    expect(unitForModality("视频")).toBe("per_second");
    expect(unitForModality("音频")).toBeNull();
    expect(unitForModality("图片")).toBeNull();
  });
});

describe("行价基准策略", () => {
  const row = (over: Partial<Parameters<typeof pickTokenBase>[0][number]>) => ({
    scope: null,
    cond: null,
    input: null,
    output: null,
    ...over,
  });

  it("token 基准:「全球」档优先,没有则第一条有价的", () => {
    const rows = [
      row({ scope: "美国", input: 1 }),
      row({ scope: "全球", input: 5 }),
      row({ scope: null, input: 2 }),
    ];
    expect(pickTokenBase(rows).scope).toBe("全球");
    expect(
      pickTokenBase([row({ scope: "美国", input: 1 }), row({ scope: null, input: 2 })]).input,
    ).toBe(1);
  });

  it("分辨率基准:最低档为入口价;同分辨率取价低;全球池含无范围行", () => {
    const rows = [
      row({ scope: "全球", cond: "1080P", output: 2 }),
      row({ scope: "全球", cond: "720P", output: 1 }),
      row({ scope: "美国", cond: "480P", output: 0.5 }), // 非全球行不参与
    ];
    expect(pickResolutionBase(rows).cond).toBe("720P");
    // 无部署范围(null)与全球同池(百炼两张表式同一事实)
    expect(
      pickResolutionBase([
        row({ scope: null, cond: "480P", output: 3 }),
        row({ scope: "全球", cond: "720P", output: 1 }),
      ]).cond,
    ).toBe("480P");
    // 同分辨率多行取价低
    const same = [
      row({ scope: "全球", cond: "720P", output: 2 }),
      row({ scope: "全球", cond: "720P", output: 1.2 }),
    ];
    expect(pickResolutionBase(same).output).toBe(1.2);
    // 无分辨率标签:回第一条有价的
    expect(pickResolutionBase([row({ scope: null, cond: null, output: 9 })]).output).toBe(9);
  });
});

describe("roleByKeywords(表头列语义框架)", () => {
  it("百炼方言:次序即优先级(combined 先于 input/output)", () => {
    expect(roleByKeywords("模型 ID(Model ID)", BAILIAN_COLUMN_RULES)).toBe("model");
    expect(roleByKeywords("服务部署范围", BAILIAN_COLUMN_RULES)).toBe("scope");
    expect(roleByKeywords("模式", BAILIAN_COLUMN_RULES)).toBe("mode");
    expect(roleByKeywords("非思考模式", BAILIAN_COLUMN_RULES)).toBeNull(); // 非表头
    expect(roleByKeywords("单次请求的输入 Token 数", BAILIAN_COLUMN_RULES)).toBe("tokenRange");
    expect(roleByKeywords("免费额度", BAILIAN_COLUMN_RULES)).toBe("free");
    expect(roleByKeywords("输出视频分辨率", BAILIAN_COLUMN_RULES)).toBe("cond");
    expect(roleByKeywords("输入和输出(元/秒)", BAILIAN_COLUMN_RULES)).toBe("combined");
    expect(roleByKeywords("输入单价(每百万Token)", BAILIAN_COLUMN_RULES)).toBe("input");
    expect(roleByKeywords("缓存命中输入单价", BAILIAN_COLUMN_RULES)).toBe("cache");
    expect(roleByKeywords("输出单价(每百万Token)", BAILIAN_COLUMN_RULES)).toBe("output");
    expect(roleByKeywords("备注", BAILIAN_COLUMN_RULES)).toBeNull();
  });
});
