/**
 * 配图工坊·拆层执行核心单测(M40 批 B,全 mock):spike 契约请求体(layer_
 * decomposition/2K/url,prompt 不传)/响应行归一(底板无 bbox、normalized
 * clamp 0-999、name/description 缺省)/成功落库(底板+图层转存文件名)/
 * 失败族(未绑定/缺底板行/HTTP 错/底板转存失败)整组 failed+usage failed
 * 行/单层转存失败不废整组。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    illustrationLayerGroup: { findUnique: vi.fn(), update: vi.fn() },
    illustrationLayer: { create: vi.fn() },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../media/storage", () => ({
  MEDIA_MIME_BY_EXT: { ".png": "image/png", ".jpg": "image/jpeg" },
  uploadsUrlToRel: (p: string) =>
    p.startsWith("/wp-content/uploads/") ? p.slice("/wp-content/uploads/".length) : null,
  mediaStorage: { get: vi.fn() },
}));
vi.mock("../media/service", () => ({ uploadMedia: vi.fn() }));
vi.mock("./resolver", () => ({
  resolveAiModel: vi.fn(async () => ({
    id: 7,
    modelKey: "g",
    modelId: "seedream-5",
    baseUrl: "https://x",
    apiKey: "k",
    protocol: "openai",
    timeoutSec: 60,
    source: "primary",
    extraParams: {},
  })),
}));
vi.mock("./usage-log", () => ({ recordAiUsage: vi.fn() }));
vi.mock("./image-client", () => ({
  downloadImage: vi.fn(),
  sniffImageMime: vi.fn(() => "image/png"),
}));

import { prisma } from "../db";
import { mediaStorage } from "../media/storage";
import { uploadMedia } from "../media/service";
import { AiAdminError } from "./errors";
import { downloadImage } from "./image-client";
import { illustrationDecomposeJob } from "./illustration-decompose";
import { recordAiUsage } from "./usage-log";

const mockedGroupFind = vi.mocked(prisma.illustrationLayerGroup.findUnique);
const mockedGroupUpdate = vi.mocked(prisma.illustrationLayerGroup.update);
const mockedLayerCreate = vi.mocked(prisma.illustrationLayer.create);
const mockedDownload = vi.mocked(downloadImage);
const mockedUpload = vi.mocked(uploadMedia);
const mockedUsage = vi.mocked(recordAiUsage);

const GROUP = {
  id: BigInt(901),
  versionId: BigInt(501),
  version: { id: BigInt(501), mediaPath: "/wp-content/uploads/2026/10/src.png" },
};

function okFetch(payload: unknown) {
  return vi.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => "",
      }) as unknown as Response,
  );
}

const mockedSourceGet = vi.mocked(mediaStorage.get);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockedSourceGet.mockResolvedValue(Buffer.alloc(1024));
  mockedGroupFind.mockResolvedValue(GROUP as never);
  mockedGroupUpdate.mockResolvedValue(GROUP as never);
  mockedLayerCreate.mockResolvedValue({} as never);
  mockedDownload.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockedUpload.mockImplementation((async ({ filename }: { filename: string }) => ({
    id: 1,
    path: `/wp-content/uploads/2026/10/${filename}`,
    reused: false,
  })) as never);
});

describe("illustrationDecomposeJob(拆层执行核心)", () => {
  it("组不存在 → AiClientError 人话,不落组更新", async () => {
    mockedGroupFind.mockResolvedValueOnce(null);
    await expect(illustrationDecomposeJob({ groupId: 404 })).rejects.toThrow("图层组不存在");
    expect(mockedGroupUpdate).not.toHaveBeenCalled();
  });

  it("未绑定模型 → 组 failed + AiAdminError(未触达调用,无计费留痕)", async () => {
    const { resolveAiModel } = await import("./resolver");
    vi.mocked(resolveAiModel).mockResolvedValueOnce(null);
    await expect(illustrationDecomposeJob({ groupId: 901 })).rejects.toThrow(AiAdminError);
    expect(mockedGroupUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    );
    expect(mockedUsage).not.toHaveBeenCalled();
  });

  it("成功主路径:契约请求体 + 底板/图层转存落库 + usage ok", async () => {
    const fetchMock = okFetch({
      data: [
        { url: "https://cdn/base.jpg", output_format: "jpeg" },
        {
          url: "https://cdn/l1.png",
          output_format: "png",
          z_index: 1,
          name: "标题文字",
          description: "主标题",
          bounding_box: { normalized: [10, 20, 300, 400] },
        },
        {
          b64_json: Buffer.from([7, 8, 9]).toString("base64"),
          output_format: "png",
          z_index: 2,
          bounding_box: { normalized: [1023.4, -5, 500.6, 999.9] },
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await illustrationDecomposeJob({ groupId: 901 });
    expect(r).toEqual({ layers: 2 });
    // 请求契约:layer_decomposition/2K/url 恒覆盖,prompt 不传,鉴权 Bearer
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x/images/generations");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "seedream-5",
      layer_decomposition: true,
      size: "2K",
      response_format: "url",
    });
    expect(body.prompt).toBeUndefined();
    expect(String(body.image)).toMatch(/^data:image\/png;base64,/);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    // 底板与图层落库:文件名随 output_format;bbox clamp 进 0-999
    expect(mockedUpload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "illu-base-901.jpg" }),
    );
    expect(mockedUpload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "illu-layer-901-1-0.png" }),
    );
    expect(mockedLayerCreate).toHaveBeenCalledTimes(2);
    expect(mockedLayerCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          zIndex: 1,
          name: "标题文字",
          description: "主标题",
          bboxX1: 10,
          bboxY2: 400,
        }),
      }),
    );
    expect(mockedLayerCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          zIndex: 2,
          name: "未命名图层",
          description: null,
          bboxX1: 999,
          bboxY1: 0,
          bboxX2: 501,
          bboxY2: 999,
        }),
      }),
    );
    expect(mockedGroupUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ready",
          baseMediaPath: "/wp-content/uploads/2026/10/illu-base-901.jpg",
        }),
      }),
    );
    expect(mockedUsage).toHaveBeenCalledWith(expect.objectContaining({ status: "ok", modelId: 7 }));
  });

  it("缺干净底板行 → 组 failed + usage failed + AiClientError", async () => {
    vi.stubGlobal(
      "fetch",
      okFetch({
        data: [
          {
            url: "https://cdn/l.png",
            output_format: "png",
            z_index: 1,
            bounding_box: { normalized: [1, 2, 3, 4] },
          },
        ],
      }),
    );
    await expect(illustrationDecomposeJob({ groupId: 901 })).rejects.toThrow("缺干净底板行");
    expect(mockedGroupUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    );
    expect(mockedUsage).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("响应带业务 error → 人话透传(拆层失败:限流)", async () => {
    vi.stubGlobal("fetch", okFetch({ data: [], error: "限流" }));
    await expect(illustrationDecomposeJob({ groupId: 901 })).rejects.toThrow("拆层失败:限流");
  });

  it("HTTP 500 → AiClientError http + 组 failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 500,
            text: async () => "boom",
            json: async () => ({}),
          }) as unknown as Response,
      ),
    );
    await expect(illustrationDecomposeJob({ groupId: 901 })).rejects.toThrow("拆层 HTTP 500");
    expect(mockedGroupUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    );
  });

  it("协议不支持 → AiClientError unsupported + 组 failed", async () => {
    const { resolveAiModel } = await import("./resolver");
    vi.mocked(resolveAiModel).mockResolvedValueOnce({
      id: 7,
      name: "m",
      modelId: "m",
      baseUrl: "https://x",
      apiKey: "k",
      protocol: "banana",
      timeoutSec: 60,
      concurrency: 1,
      supportsVision: false,
      source: "primary",
      extraParams: {},
    });
    await expect(illustrationDecomposeJob({ groupId: 901 })).rejects.toThrow("拆层协议不支持");
    expect(mockedGroupUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    );
  });

  it("底板下载失败 → 整组 failed(底板转存失败前缀)+ usage failed", async () => {
    mockedDownload.mockRejectedValueOnce(new Error("ECONNRESET"));
    vi.stubGlobal(
      "fetch",
      okFetch({
        data: [
          { url: "https://cdn/base.jpg", output_format: "jpeg" },
          {
            url: "https://cdn/l.png",
            output_format: "png",
            z_index: 1,
            bounding_box: { normalized: [1, 2, 3, 4] },
          },
        ],
      }),
    );
    await expect(illustrationDecomposeJob({ groupId: 901 })).rejects.toThrow("底板转存失败");
    expect(mockedLayerCreate).not.toHaveBeenCalled();
    expect(mockedUsage).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("单层转存失败不废整组:跳过失败层,余层照常落库", async () => {
    mockedDownload
      .mockResolvedValueOnce(new Uint8Array([1])) // 底板
      .mockRejectedValueOnce(new Error("ECONNRESET")) // 层 1 失败
      .mockResolvedValueOnce(new Uint8Array([2])); // 层 2
    vi.stubGlobal(
      "fetch",
      okFetch({
        data: [
          { url: "https://cdn/base.jpg", output_format: "jpeg" },
          {
            url: "https://cdn/l1.png",
            output_format: "png",
            z_index: 1,
            bounding_box: { normalized: [1, 2, 3, 4] },
          },
          {
            url: "https://cdn/l2.png",
            output_format: "png",
            z_index: 2,
            bounding_box: { normalized: [5, 6, 7, 8] },
          },
        ],
      }),
    );
    const r = await illustrationDecomposeJob({ groupId: 901 });
    expect(r).toEqual({ layers: 1 });
    expect(mockedLayerCreate).toHaveBeenCalledTimes(1);
    expect(mockedGroupUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ready" }) }),
    );
  });

  it("全部图层转存失败 → 组 failed + usage failed", async () => {
    mockedDownload
      .mockResolvedValueOnce(new Uint8Array([1])) // 底板
      .mockRejectedValue(new Error("ECONNRESET")); // 全部图层
    vi.stubGlobal(
      "fetch",
      okFetch({
        data: [
          { url: "https://cdn/base.jpg", output_format: "jpeg" },
          {
            url: "https://cdn/l1.png",
            output_format: "png",
            z_index: 1,
            bounding_box: { normalized: [1, 2, 3, 4] },
          },
        ],
      }),
    );
    await expect(illustrationDecomposeJob({ groupId: 901 })).rejects.toThrow("全部转存失败");
    expect(mockedUsage).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });
});
