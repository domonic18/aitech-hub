/**
 * 文生图客户端单测(M14 批⑥):b64 解码(data: 前缀容错/空数据拒绝)、
 * 魔数嗅探(png/jpeg/webp/未知格式拒绝)、封面 prompt 组装(标题/摘要/标签
 * 与禁令段)。
 */
import { describe, expect, it } from "vitest";

import { buildCoverPrompt } from "./cover-prompt";
import { decodeImageB64, sniffImageMime } from "./image-client";
import { AiClientError } from "./errors";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("decodeImageB64", () => {
  it("裸 b64 与 data: 前缀形态均可解", () => {
    expect(decodeImageB64(PNG_1X1).byteLength).toBeGreaterThan(0);
    expect(decodeImageB64(`data:image/png;base64,${PNG_1X1}`).byteLength).toBeGreaterThan(0);
  });

  it("空数据 → 拒绝", () => {
    expect(() => decodeImageB64("")).toThrow(AiClientError);
  });
});

describe("sniffImageMime", () => {
  it("png / jpeg / webp 魔数各归其位", () => {
    expect(sniffImageMime(decodeImageB64(PNG_1X1))).toBe("image/png");
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageMime(jpeg)).toBe("image/jpeg");
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(sniffImageMime(webp)).toBe("image/webp");
  });

  it("未知格式(svg/文本)→ 拒绝", () => {
    const svg = new TextEncoder().encode("<svg xmlns=...></svg>");
    expect(() => sniffImageMime(svg)).toThrow(AiClientError);
  });
});

describe("buildCoverPrompt", () => {
  it("标题/摘要/标签全量进入 prompt,含禁令与横版约束", () => {
    const p = buildCoverPrompt({
      title: "Claude 5 发布",
      excerpt: "Anthropic 发布新一代模型",
      tags: ["Claude", "大模型"],
    });
    expect(p).toContain("Claude 5 发布");
    expect(p).toContain("Anthropic 发布新一代模型");
    expect(p).toContain("Claude、大模型");
    expect(p).toContain("禁止");
    expect(p).toContain("16:9");
  });

  it("无标签时省略关键词行;空摘要占位", () => {
    const p = buildCoverPrompt({ title: "标题", excerpt: "", tags: [] });
    expect(p).not.toContain("关键词:");
    expect(p).toContain("摘要:(无)");
  });
});
