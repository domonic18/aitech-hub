/**
 * cover-gen hold/adopt 单测(M31,全 mock):hold 生图只落临时盘(虚拟路径,
 * 不调 uploadMedia);adopt 读临时件 → uploadMedia → 行切正式路径 → 清临时;
 * 已入库行幂等;临时件失效报人话。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: { coverCandidate: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("../env", () => ({ env: { MEDIA_DIR: "/tmp/cover-test-media" } }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../queue", () => ({ COVER_JOB_GEN: "gen", getQueue: vi.fn(() => ({ add: vi.fn() })) }));
vi.mock("./resolver", () => ({
  resolveAiModel: vi.fn(async () => ({
    id: "m1",
    modelKey: "g",
    modelId: "cogview-3-flash",
    baseUrl: "https://x",
    apiKey: "k",
    protocol: "openai-images",
    timeoutSec: 60,
    source: "primary",
    extraParams: {},
  })),
}));
vi.mock("./usage-log", () => ({ recordAiUsage: vi.fn() }));
vi.mock("./image-client", () => ({
  generateImages: vi.fn(async () => [{ b64: "AAAA" }]),
  decodeImageB64: vi.fn(() => new Uint8Array([1, 2, 3])),
  downloadImage: vi.fn(),
  sniffImageMime: vi.fn(() => "image/png"),
}));
vi.mock("../media/service", () => ({ uploadMedia: vi.fn() }));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => new Uint8Array([9, 9, 9])),
  rm: vi.fn(async () => undefined),
  default: {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => new Uint8Array([9, 9, 9])),
    rm: vi.fn(async () => undefined),
  },
}));

import { readFile, rm, writeFile } from "node:fs/promises";

import { prisma } from "../db";
import { uploadMedia } from "../media/service";
import { adoptCoverCandidate, coverGenJob, COVER_TEMP_PREFIX } from "./cover-generate";

const mockedCreate = vi.mocked(prisma.coverCandidate.create);
const mockedFind = vi.mocked(prisma.coverCandidate.findUnique);
const mockedUpdate = vi.mocked(prisma.coverCandidate.update);
const mockedUpload = vi.mocked(uploadMedia);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readFile).mockClear();
});

describe("coverGenJob hold 模式", () => {
  it("落临时盘:候选行虚拟路径,不调 uploadMedia", async () => {
    mockedCreate.mockResolvedValue({} as never);
    const r = await coverGenJob({
      token: "tok12345",
      postId: "156",
      title: "标题",
      excerpt: "",
      tags: [],
      contentMd: "",
      prompt: "手填提示词",
      hold: true,
    });
    expect(r.generated).toBe(1);
    expect(mockedUpload).not.toHaveBeenCalled();
    const arg = mockedCreate.mock.calls[0][0] as { data: { mediaPath: string } };
    expect(arg.data.mediaPath).toBe(`${COVER_TEMP_PREFIX}tok12345/candidate-1.png`);
    expect(writeFile).toHaveBeenCalledOnce();
  });
});

describe("adoptCoverCandidate", () => {
  it("临时件 → uploadMedia → 行切正式路径 → 清临时目录", async () => {
    mockedFind.mockResolvedValue({
      mediaPath: `${COVER_TEMP_PREFIX}tok12345/candidate-1.png`,
      token: "tok12345",
    } as never);
    mockedUpdate.mockResolvedValue({} as never);
    mockedUpload.mockResolvedValue({ path: "/wp-content/uploads/2026/10/a.png" } as never);

    const path = await adoptCoverCandidate("12");
    expect(path).toBe("/wp-content/uploads/2026/10/a.png");
    expect(mockedUpload).toHaveBeenCalledOnce();
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: BigInt(12) },
      data: { mediaPath: "/wp-content/uploads/2026/10/a.png" },
    });
    expect(rm).toHaveBeenCalled();
  });

  it("已入库行幂等返回现路径,不再上传", async () => {
    mockedFind.mockResolvedValue({
      mediaPath: "/wp-content/uploads/2026/10/a.png",
      token: "tok12345",
    } as never);
    expect(await adoptCoverCandidate("12")).toBe("/wp-content/uploads/2026/10/a.png");
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it("临时件已失效 → 人话错误", async () => {
    mockedFind.mockResolvedValue({
      mediaPath: `${COVER_TEMP_PREFIX}tok12345/candidate-1.png`,
      token: "tok12345",
    } as never);
    vi.mocked(readFile).mockRejectedValueOnce(new Error("ENOENT"));
    await expect(adoptCoverCandidate("12")).rejects.toThrow("临时文件已失效");
  });
});
