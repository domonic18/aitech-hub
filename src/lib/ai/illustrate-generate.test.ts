/**
 * 文生图执行核心单测(M39 批④,全 mock,同 cover-generate.test.ts 桩法):
 * 未绑定人话报错且零计费行 / 成功按张计费入库 / 请求级失败落 failed 行原样
 * 上抛 / url 形态同源带鉴权转存 / 单张入库失败不废整批 / 张数收敛 / 宽高比
 * → 分辨率映射(§13.9,未知值回落缺省 16:9)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./resolver", () => ({ resolveAiModel: vi.fn() }));
vi.mock("./usage-log", () => ({ recordAiUsage: vi.fn() }));
vi.mock("./image-client", () => ({
  generateImages: vi.fn(),
  decodeImageB64: vi.fn(() => new Uint8Array([1, 2, 3])),
  downloadImage: vi.fn(),
  sniffImageMime: vi.fn(() => "image/png"),
}));
vi.mock("../media/service", () => ({ uploadMedia: vi.fn() }));
// 参照图装载桩(M39 批③):uploadsUrlToRel / MEDIA_MIME_BY_EXT 用最小同构实现
// (storage.test.ts 另有真实现覆盖),mediaStorage.get 逐测注入
const storageGet = vi.hoisted(() => vi.fn());
vi.mock("../media/storage", () => ({
  uploadsUrlToRel: (p: string): string | null =>
    p.startsWith("/wp-content/uploads/") && !p.includes("..")
      ? p.slice("/wp-content/uploads/".length)
      : null,
  MEDIA_MIME_BY_EXT: { ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" },
  mediaStorage: { get: storageGet },
}));

import { AiClientError } from "./errors";
import { decodeImageB64, downloadImage, generateImages, sniffImageMime } from "./image-client";
import { uploadMedia } from "../media/service";
import { generateIllustrations } from "./illustrate-generate";
import { recordAiUsage } from "./usage-log";
import { resolveAiModel, type ResolvedAiModel } from "./resolver";

const mockedResolve = vi.mocked(resolveAiModel);
const mockedGenerate = vi.mocked(generateImages);
const mockedDownload = vi.mocked(downloadImage);
const mockedUpload = vi.mocked(uploadMedia);
const mockedUsage = vi.mocked(recordAiUsage);

const MODEL: ResolvedAiModel = {
  id: 1,
  name: "Seedream 5.0 pro",
  modelId: "doubao-seedream-5-0-pro-260628",
  baseUrl: "https://ark.example.com/api/v3",
  apiKey: "k",
  protocol: "openai",
  timeoutSec: 60,
  concurrency: 1,
  supportsVision: false,
  source: "primary",
  extraParams: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockResolvedValue(MODEL);
  mockedGenerate.mockResolvedValue([{ b64: "AAAA" }]);
  mockedUpload.mockResolvedValue({ path: "/wp-content/uploads/2026/10/illu-a.png" } as never);
});

describe("generateIllustrations(文生图执行核心)", () => {
  it("未绑定 illustrate 模型 → 人话 AiAdminError,零计费行零生图", async () => {
    mockedResolve.mockResolvedValueOnce(null);
    await expect(generateIllustrations({ prompt: "p" })).rejects.toMatchObject({
      code: "disabled",
      message: expect.stringContaining("插图配图(illustrate)"),
    });
    expect(mockedGenerate).not.toHaveBeenCalled();
    expect(mockedUsage).not.toHaveBeenCalled();
  });

  it("b64 成功:生图入参齐整,按张计费 ok 行,uploadMedia 得 png 路径", async () => {
    const r = await generateIllustrations({ prompt: "一只机械鹤立于数据流之上" });
    expect(r.images).toEqual([
      { path: "/wp-content/uploads/2026/10/illu-a.png", mime: "image/png" },
    ]);
    expect(mockedGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "openai",
        baseUrl: MODEL.baseUrl,
        modelId: MODEL.modelId,
        apiKey: MODEL.apiKey,
        prompt: "一只机械鹤立于数据流之上",
        n: 1,
        size: "1344x768",
        timeoutSec: 60,
        extraParams: {},
      }),
    );
    expect(mockedUsage).toHaveBeenCalledTimes(1);
    expect(mockedUsage).toHaveBeenCalledWith(
      expect.objectContaining({ role: "illustrate", modelId: 1, status: "ok" }),
    );
    expect(decodeImageB64).toHaveBeenCalledWith("AAAA");
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        mime: "image/png",
        filename: expect.stringMatching(/^illu-.*\.png$/),
      }),
    );
  });

  it("url 形态:downloadImage 带同源鉴权信息转存;文件名扩展随嗅探 mime", async () => {
    mockedGenerate.mockResolvedValueOnce([{ url: "https://ark.example.com/api/v3/img/1" }]);
    vi.mocked(sniffImageMime).mockReturnValueOnce("image/jpeg");
    await generateIllustrations({ prompt: "p" });
    expect(mockedDownload).toHaveBeenCalledWith("https://ark.example.com/api/v3/img/1", 60, {
      baseUrl: MODEL.baseUrl,
      apiKey: MODEL.apiKey,
    });
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringMatching(/\.jpg$/) }),
    );
  });

  it("请求级失败:落 failed 行(整批无图不计费)且原样上抛", async () => {
    mockedGenerate.mockRejectedValueOnce(new AiClientError("timeout", "生图超时(60s)"));
    await expect(generateIllustrations({ prompt: "p" })).rejects.toMatchObject({
      kind: "timeout",
    });
    expect(mockedUsage).toHaveBeenCalledTimes(1);
    expect(mockedUsage).toHaveBeenCalledWith(
      expect.objectContaining({ role: "illustrate", status: "failed" }),
    );
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it("单张入库失败不废整批:首张 uploadMedia 拒,次张正常 → 返回 1 张", async () => {
    mockedGenerate.mockResolvedValueOnce([{ b64: "AAAA" }, { b64: "BBBB" }]);
    mockedUpload.mockRejectedValueOnce(new Error("媒体库写入失败"));
    mockedUpload.mockResolvedValueOnce({ path: "/wp-content/uploads/2026/10/illu-b.png" } as never);
    const r = await generateIllustrations({ prompt: "p", n: 2 });
    expect(r.images).toHaveLength(1);
    expect(r.images[0]?.path).toBe("/wp-content/uploads/2026/10/illu-b.png");
    // 计费按生图成功张数(2),与入库成败无关
    expect(mockedUsage).toHaveBeenCalledTimes(2);
  });

  it("全部入库失败 → business 错人话;备用模型计费落 degraded 行", async () => {
    mockedGenerate.mockResolvedValueOnce([{ b64: "AAAA" }]);
    mockedUpload.mockRejectedValueOnce(new Error("媒体库写入失败"));
    await expect(generateIllustrations({ prompt: "p" })).rejects.toMatchObject({
      kind: "business",
    });
    mockedResolve.mockResolvedValueOnce({ ...MODEL, source: "backup" });
    mockedGenerate.mockResolvedValueOnce([{ b64: "AAAA" }]);
    mockedUpload.mockResolvedValueOnce({ path: "/wp-content/uploads/2026/10/illu-c.png" } as never);
    await generateIllustrations({ prompt: "p" });
    expect(mockedUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: "illustrate", status: "degraded" }),
    );
  });

  it("张数收敛:越界 n 收进 [1,3](§13.9 关键小节至多 3 张择优)", async () => {
    mockedGenerate.mockResolvedValueOnce([{ b64: "AAAA" }, { b64: "BBBB" }, { b64: "CCCC" }]);
    mockedUpload.mockResolvedValue({ path: "/wp-content/uploads/2026/10/illu-d.png" } as never);
    await generateIllustrations({ prompt: "p", n: 5 });
    expect(mockedGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ n: 3 }));
    expect(sniffImageMime).toHaveBeenCalledTimes(3);
  });

  it("宽高比映射(§13.9):3:4 → 竖版 864x1152;未知值回落缺省 16:9", async () => {
    mockedGenerate.mockResolvedValue([{ b64: "AAAA" }]);
    await generateIllustrations({ prompt: "p", aspect: "3:4" });
    expect(mockedGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ size: "864x1152" }));
    await generateIllustrations({ prompt: "p", aspect: "9:21" });
    expect(mockedGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ size: "1344x768" }));
    await generateIllustrations({ prompt: "p", aspect: "1:1" });
    expect(mockedGenerate).toHaveBeenLastCalledWith(expect.objectContaining({ size: "1024x1024" }));
  });

  it("参照图合法:mediaStorage 字节 → data URL 进 image 参数;referenceError 为 null", async () => {
    storageGet.mockResolvedValueOnce(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const r = await generateIllustrations({
      prompt: "p",
      referencePath: "/wp-content/uploads/2026/10/ref.png",
    });
    expect(r.referenceError).toBeNull();
    expect(storageGet).toHaveBeenCalledWith("2026/10/ref.png");
    const call = mockedGenerate.mock.calls[0]?.[0];
    expect(call?.image).toBe(
      `data:image/png;base64,${Buffer.from(new Uint8Array([0x89, 0x50, 0x4e, 0x47])).toString("base64")}`,
    );
  });

  it("参照图降级不阻塞(§13.11 决策 5 兜底):路径非法/读取失败/超帽/格式不支持均无 image 照常出图,人话原因带回", async () => {
    mockedGenerate.mockResolvedValue([{ b64: "AAAA" }]);
    // 外链(非站内前缀)
    let r = await generateIllustrations({
      prompt: "p",
      referencePath: "https://cdn.example/x.png",
    });
    expect(r.referenceError).toContain("路径不合法");
    expect(mockedGenerate.mock.calls[0]?.[0]?.image).toBeUndefined();
    // 穿越
    r = await generateIllustrations({ prompt: "p", referencePath: "/wp-content/uploads/../etc" });
    expect(r.referenceError).toContain("路径不合法");
    // 文件不存在
    storageGet.mockResolvedValueOnce(null);
    r = await generateIllustrations({ prompt: "p", referencePath: "/wp-content/uploads/a/x.png" });
    expect(r.referenceError).toContain("读取失败");
    expect(mockedGenerate.mock.calls[2]?.[0]?.image).toBeUndefined();
    // 超 6MB 帽
    storageGet.mockResolvedValueOnce(new Uint8Array(6 * 1024 * 1024 + 1));
    r = await generateIllustrations({ prompt: "p", referencePath: "/wp-content/uploads/a/x.png" });
    expect(r.referenceError).toContain("6MB");
    // 格式不支持(svg 无映射)
    storageGet.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    r = await generateIllustrations({ prompt: "p", referencePath: "/wp-content/uploads/a/x.svg" });
    expect(r.referenceError).toContain("格式不支持");
    expect(mockedGenerate).toHaveBeenCalledTimes(5); // 全程照常出图
  });
});
