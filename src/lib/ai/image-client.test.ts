/**
 * 文生图客户端单测(M14 批⑥):b64 解码(data: 前缀容错/空数据拒绝)、
 * 魔数嗅探(png/jpeg/webp/未知格式拒绝)、封面 prompt 组装(标题/摘要/标签
 * 与禁令段)。M16 问题1/2 扩:url 形态解析、扩展参数合并(保留键不可覆盖)、
 * 单图供应商补齐轮次、url 转存下载。fetch 经 vi.stubGlobal 注入(probe 同手法)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCoverPrompt } from "./cover-prompt";
import {
  decodeImageB64,
  downloadImage,
  generateImages,
  parseImagesResponse,
  sniffImageMime,
} from "./image-client";
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

  it("extraParams 保留键显式 null = 整键剔除,null 值不透传(M39 AiHubMix 严格校验适配)", async () => {
    const { calls } = stubFetchSequence([
      { output: [{ content_url: "https://aihubmix.com/a.png" }] },
    ]);
    await generateImages({
      ...BASE_INPUT,
      n: 1,
      extraParams: { size: null, response_format: null, watermark_enabled: false },
    });
    const body = calls[0] as Record<string, unknown>;
    expect(body.size).toBeUndefined(); // 剔除,不发 null 也不发缺省值
    expect(body.response_format).toBeUndefined();
    expect(body.model).toBe("cogview-3-flash"); // 未剔除的保留键照常在场
    expect(body.prompt).toBe("横版科技封面");
    expect(body.n).toBe(1);
    expect(body.watermark_enabled).toBe(false); // 非 null 扩展参数照常透传
  });

  it("参照图(M39 批③):传 image 时进请求体顶层;不传时键不出现", async () => {
    const { calls } = stubFetchSequence([{ data: [{ b64_json: PNG_1X1 }] }]);
    const dataUrl = `data:image/png;base64,${PNG_1X1}`;
    await generateImages({ ...BASE_INPUT, n: 1, image: dataUrl });
    expect((calls[0] as Record<string, unknown>).image).toBe(dataUrl);
    // 补齐轮次同样携带(参照图属请求级参数)
    const { calls: calls2 } = stubFetchSequence([
      { data: [{ b64_json: PNG_1X1 }] },
      { data: [{ b64_json: PNG_1X1 }] },
    ]);
    await generateImages({ ...BASE_INPUT, image: dataUrl });
    expect((calls2[1] as Record<string, unknown>).image).toBe(dataUrl);
    const { calls: calls3 } = stubFetchSequence([{ data: [{ b64_json: PNG_1X1 }] }]);
    await generateImages({ ...BASE_INPUT, n: 1 });
    expect((calls3[0] as Record<string, unknown>).image).toBeUndefined();
  });
});

describe("generateImages(M39 AiHubMix 形态)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("output[] 数组与 content_url 键等价解析(与 OpenAI data[]/url 同归一)", async () => {
    stubFetchSequence([
      {
        id: "t1",
        status: "completed",
        output: [
          { index: 0, b64_json: PNG_1X1 },
          { index: 1, content_url: "https://aihubmix.com/file/a.png" },
        ],
      },
    ]);
    const images = await generateImages(BASE_INPUT);
    expect(images).toEqual([{ b64: PNG_1X1 }, { url: "https://aihubmix.com/file/a.png" }]);
  });

  it("data[] 缺失且 output[] 缺失:报契约漂移;有 error 文案则透传", async () => {
    stubFetchSequence([{ id: "t1", status: "failed", error: "model overloaded" }]);
    await expect(generateImages(BASE_INPUT)).rejects.toThrow(/model overloaded/);

    stubFetchSequence([{}]);
    await expect(generateImages(BASE_INPUT)).rejects.toThrow(/契约漂移/);
  });

  it("空 output 数组随 200 回 error:末轮无图透传供应商文案", async () => {
    stubFetchSequence([{ status: "failed", output: [], error: "quota exceeded" }]);
    await expect(generateImages(BASE_INPUT)).rejects.toThrow(/quota exceeded/);
  });
});

describe("parseImagesResponse(E2 解析收口:generateImages 与 probe 单源)", () => {
  it("data[] 优先于 output[] 同现不歧义;b64/url/content_url 三键归一", () => {
    const r = parseImagesResponse({
      data: [{ b64_json: PNG_1X1 }],
      output: [{ content_url: "https://x.example/b.png" }],
    });
    expect(r.images).toEqual([{ b64: PNG_1X1 }]);
    expect(r.hasRows).toBe(true);
    expect(r.bizError).toBeNull();
  });

  it("单行脏数据跳过不弃全轮(非 https/超长/空键);合法行保留", () => {
    const r = parseImagesResponse({
      data: [
        { url: "http://insecure.example/a.png" },
        { url: `https://cdn.example.com/${"x".repeat(2100)}` },
        { foo: 1 },
        { content_url: "https://cdn.example.com/ok.png" },
      ],
    });
    expect(r.images).toEqual([{ url: "https://cdn.example.com/ok.png" }]);
  });

  it("200 携 error 文案透传;缺 data/output 数组报 hasRows:false(契约漂移)", () => {
    const withErr = parseImagesResponse({ status: "failed", output: [], error: "quota exceeded" });
    expect(withErr.bizError).toBe("quota exceeded");
    expect(withErr.hasRows).toBe(true);
    expect(withErr.images).toEqual([]);

    const drift = parseImagesResponse({ id: "t1", status: "failed" });
    expect(drift.hasRows).toBe(false);
    expect(drift.bizError).toBeNull();
    expect(drift.images).toEqual([]);
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

  it("同源下载带 Authorization;跨宿主/未传 auth 一律不带(M39 密钥不出供应商边界)", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const stub = (): void => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: unknown, init?: RequestInit) => {
          seen.push((init?.headers ?? {}) as Record<string, unknown>);
          return new Response(new Uint8Array([1]), { status: 200 });
        }),
      );
    };
    const auth = { baseUrl: "https://aihubmix.com/ai/v1", apiKey: "k-ah" };

    stub(); // 同宿主(含路径差异):带 Bearer
    await downloadImage("https://aihubmix.com/file/a.png", 30, auth);
    expect(seen[0].authorization).toBe("Bearer k-ah");

    stub(); // 跨宿主(第三方 CDN):不带
    await downloadImage("https://cdn.example.com/a.png", 30, auth);
    expect(seen[1].authorization).toBeUndefined();

    stub(); // 未传 auth(既有调用方):不带
    await downloadImage("https://aihubmix.com/file/a.png", 30);
    expect(seen[2].authorization).toBeUndefined();

    stub(); // baseUrl 非法:按非同源处理,不带
    await downloadImage("https://aihubmix.com/file/a.png", 30, {
      baseUrl: "::not-a-url",
      apiKey: "k-ah",
    });
    expect(seen[3].authorization).toBeUndefined();
  });
});
