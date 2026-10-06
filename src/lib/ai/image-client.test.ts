/**
 * 文生图客户端单测(M14 批⑥):b64 解码(data: 前缀容错/空数据拒绝)、
 * 魔数嗅探(png/jpeg/webp/未知格式拒绝)、封面 prompt 组装(标题/摘要/标签
 * 与禁令段)。M16 问题1/2 扩:url 形态解析、扩展参数合并(保留键不可覆盖)、
 * 单图供应商补齐轮次、url 转存下载。fetch 经 vi.stubGlobal 注入(probe 同手法)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCoverPrompt } from "./cover-prompt";
import { decodeImageB64, downloadImage, generateImages, sniffImageMime } from "./image-client";
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

/** fetch 注入工具:按序回响应并记录请求体(probe.test.ts 同手法) */
function stubFetchSequence(bodies: unknown[]): { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse((init?.body ?? "{}") as string) as Record<string, unknown>);
    const next = bodies[Math.min(calls.length - 1, bodies.length - 1)];
    return new Response(JSON.stringify(next), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

const BASE_INPUT = {
  protocol: "openai",
  baseUrl: "https://open.example.com/api/paas/v4",
  modelId: "cogview-3-flash",
  apiKey: "k-test",
  prompt: "横版科技封面",
  n: 2,
  size: "1344x768",
  timeoutSec: 60,
};

describe("generateImages(M16 问题1/2 扩)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("b64 形态直解;url 形态原样透出(智谱契约)", async () => {
    stubFetchSequence([
      { data: [{ b64_json: PNG_1X1 }, { url: "https://cdn.example.com/a.png" }] },
    ]);
    const images = await generateImages(BASE_INPUT);
    expect(images).toEqual([{ b64: PNG_1X1 }, { url: "https://cdn.example.com/a.png" }]);
  });

  it("扩展参数浅合并进请求体;保留键不可被覆盖", async () => {
    const { calls } = stubFetchSequence([{ data: [{ b64_json: PNG_1X1 }] }]);
    await generateImages({
      ...BASE_INPUT,
      n: 1,
      extraParams: {
        watermark_enabled: false,
        model: "hack-override",
        prompt: "hack",
        n: 99,
        size: "1x1",
        response_format: "url",
      },
    });
    const body = calls[0] as Record<string, unknown>;
    expect(body.watermark_enabled).toBe(false);
    expect(body.model).toBe("cogview-3-flash");
    expect(body.prompt).toBe("横版科技封面");
    expect(body.n).toBe(1);
    expect(body.size).toBe("1344x768");
    expect(body.response_format).toBe("b64_json");
  });

  it("首轮不足 n 顺序补请求凑满候选(智谱单图契约)", async () => {
    const { calls } = stubFetchSequence([
      { data: [{ url: "https://cdn.example.com/1.png" }] },
      { data: [{ url: "https://cdn.example.com/2.png" }] },
    ]);
    const images = await generateImages(BASE_INPUT);
    expect(images).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect((calls[0] as Record<string, unknown>).n).toBe(2);
    expect((calls[1] as Record<string, unknown>).n).toBe(1);
  });

  it("供应商回空 data 数组:不再补轮,报契约错", async () => {
    stubFetchSequence([{ data: [] }]);
    await expect(generateImages(BASE_INPUT)).rejects.toThrow(AiClientError);
  });

  it("非 openai 协议门禁不变", async () => {
    await expect(generateImages({ ...BASE_INPUT, protocol: "anthropic" })).rejects.toThrow(
      /协议不支持/,
    );
  });
});

describe("downloadImage(M16 问题1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("下载 bytes;HTTP 非 2xx / 空体报错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );
    const bytes = await downloadImage("https://cdn.example.com/a.png", 30);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 403 })),
    );
    await expect(downloadImage("https://cdn.example.com/a.png", 30)).rejects.toThrow(
      /转存 HTTP 403/,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(0), { status: 200 })),
    );
    await expect(downloadImage("https://cdn.example.com/a.png", 30)).rejects.toThrow(/转存为空/);
  });
});
