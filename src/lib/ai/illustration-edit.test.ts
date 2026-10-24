/**
 * 配图工坊·交互编辑执行核心单测(M40 批 B,全 mock):三回路 prompt 模板单源
 * /未绑定模型人话拒/成功路径(generateImages 收 2K+image 参照通道,候选转存
 * uploadMedia)/生图失败与空结果的 usage failed 行/源图读取三道人话防线
 * (路径不合法/文件缺失/体积与格式帽)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../media/storage", () => ({
  MEDIA_MIME_BY_EXT: { ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" },
  uploadsUrlToRel: (p: string) =>
    p.startsWith("/wp-content/uploads/") ? p.slice("/wp-content/uploads/".length) : null,
  mediaStorage: { get: vi.fn() },
}));
vi.mock("../media/service", () => ({ uploadMedia: vi.fn() }));
vi.mock("./resolver", () => ({
  resolveAiModel: vi.fn(async () => ({
    id: 7,
    name: "seedream",
    modelId: "seedream-5",
    baseUrl: "https://x",
    apiKey: "k",
    protocol: "openai",
    timeoutSec: 60,
    concurrency: 1,
    supportsVision: false,
    source: "primary",
    extraParams: {},
  })),
}));
vi.mock("./usage-log", () => ({ recordAiUsage: vi.fn() }));
const queueAdd = vi.hoisted(() => vi.fn());
const queueGetJob = vi.hoisted(() => vi.fn());
vi.mock("../queue", () => ({
  QUEUE_ILLUSTRATION_STUDIO: "illustration-studio",
  ILLUSTRATION_JOB_EDIT: "edit",
  getQueue: vi.fn(() => ({ add: queueAdd, getJob: queueGetJob })),
}));
vi.mock("./image-client", () => ({
  generateImages: vi.fn(async () => [{ b64: "AAAA" }]),
  decodeImageB64: vi.fn(() => new Uint8Array([1, 2, 3])),
  downloadImage: vi.fn(),
  sniffImageMime: vi.fn(() => "image/png"),
}));

import { mediaStorage } from "../media/storage";
import { uploadMedia } from "../media/service";
import { AiAdminError, AiClientError } from "./errors";
import { generateImages, sniffImageMime } from "./image-client";
import {
  buildEditPrompt,
  editIllustration,
  enqueueIllustrationEdit,
  illustrationEditJobStatus,
} from "./illustration-edit";
import { recordAiUsage } from "./usage-log";

const mockedGet = vi.mocked(mediaStorage.get);
const mockedGen = vi.mocked(generateImages);
const mockedUpload = vi.mocked(uploadMedia);
const mockedUsage = vi.mocked(recordAiUsage);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockResolvedValue(Buffer.alloc(1024));
  mockedUpload.mockResolvedValue({
    id: 1,
    path: "/wp-content/uploads/2026/10/illu-edit-x.png",
    reused: false,
  } as never);
});

describe("buildEditPrompt(三回路模板单源)", () => {
  it("改字:新文案内嵌 bbox(normalized 0-999 左上原点)", () => {
    expect(buildEditPrompt("text", "100 200 300 400", "17AI")).toBe(
      "将图1中 <bbox>100 200 300 400</bbox> 区域内的文字修改为:17AI",
    );
  });
  it("消除:无补充走默认模板,有补充拼冒号尾注", () => {
    expect(buildEditPrompt("erase", "0 0 99 99")).toBe(
      "将图1中 <bbox>0 0 99 99</bbox> 区域内的元素完全消除,背景自然无缝补全",
    );
    expect(buildEditPrompt("erase", "0 0 99 99", "保留投影")).toBe(
      "将图1中 <bbox>0 0 99 99</bbox> 区域内的元素完全消除,背景自然无缝补全:保留投影",
    );
  });
  it("重绘:重绘描述拼冒号", () => {
    expect(buildEditPrompt("redraw", "10 20 30 40", "换成蓝火山")).toBe(
      "将图1中 <bbox>10 20 30 40</bbox> 区域重绘:换成蓝火山",
    );
  });
});

describe("editIllustration(交互编辑)", () => {
  it("未绑定模型 → AiAdminError disabled,不触达生图与计费", async () => {
    const { resolveAiModel } = await import("./resolver");
    vi.mocked(resolveAiModel).mockResolvedValueOnce(null);
    await expect(
      editIllustration({
        imagePath: "/wp-content/uploads/a.png",
        mode: "text",
        bbox: "1 2 3 4",
        instruction: "X",
      }),
    ).rejects.toThrow(AiAdminError);
    expect(mockedGen).not.toHaveBeenCalled();
    expect(mockedUsage).not.toHaveBeenCalled();
  });

  it("成功:generateImages 收 2K+image data URL+模板 prompt,候选经 uploadMedia 落库", async () => {
    const r = await editIllustration({
      imagePath: "/wp-content/uploads/2026/10/base.png",
      mode: "text",
      bbox: "100 200 300 400",
      instruction: "17AI",
    });
    expect(r).toEqual({ imagePath: "/wp-content/uploads/2026/10/illu-edit-x.png" });
    expect(mockedGen).toHaveBeenCalledWith(
      expect.objectContaining({
        n: 1,
        size: "2K",
        image: expect.stringMatching(/^data:image\/png;base64,/),
        prompt: "将图1中 <bbox>100 200 300 400</bbox> 区域内的文字修改为:17AI",
      }),
    );
    expect(mockedUsage).toHaveBeenCalledWith(expect.objectContaining({ status: "ok", modelId: 7 }));
  });

  it("源图路径不合法(非站内)→ AiAdminError 人话", async () => {
    await expect(
      editIllustration({ imagePath: "https://cdn.example/x.png", mode: "erase", bbox: "1 2 3 4" }),
    ).rejects.toThrow("图片路径不合法");
  });

  it("源图文件缺失 → AiAdminError 人话", async () => {
    mockedGet.mockResolvedValueOnce(null);
    await expect(
      editIllustration({ imagePath: "/wp-content/uploads/a.png", mode: "erase", bbox: "1 2 3 4" }),
    ).rejects.toThrow("图片文件读取失败");
  });

  it("源图超 6MB 体积帽 → AiAdminError 人话", async () => {
    mockedGet.mockResolvedValueOnce(Buffer.alloc(6 * 1024 * 1024 + 1));
    await expect(
      editIllustration({ imagePath: "/wp-content/uploads/a.png", mode: "erase", bbox: "1 2 3 4" }),
    ).rejects.toThrow("体积帽");
  });

  it("源图格式不支持 → AiAdminError 人话", async () => {
    await expect(
      editIllustration({ imagePath: "/wp-content/uploads/a.webm", mode: "erase", bbox: "1 2 3 4" }),
    ).rejects.toThrow("格式不支持");
  });

  it("生图失败 → usage failed 行后原样上抛", async () => {
    mockedGen.mockRejectedValueOnce(new AiClientError("timeout", "生图超时(60s)"));
    await expect(
      editIllustration({
        imagePath: "/wp-content/uploads/a.png",
        mode: "redraw",
        bbox: "1 2 3 4",
        instruction: "x",
      }),
    ).rejects.toThrow("生图超时");
    expect(mockedUsage).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("生图返回空数组 → AiClientError business + usage failed 行", async () => {
    mockedGen.mockResolvedValueOnce([]);
    await expect(
      editIllustration({
        imagePath: "/wp-content/uploads/a.png",
        mode: "text",
        bbox: "1 2 3 4",
        instruction: "x",
      }),
    ).rejects.toThrow("空结果");
    expect(mockedUsage).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("sniff 出 jpeg → 落盘扩展名随 mime(illu-edit-*.jpg)", async () => {
    vi.mocked(sniffImageMime).mockReturnValueOnce("image/jpeg");
    await editIllustration({
      imagePath: "/wp-content/uploads/a.jpg",
      mode: "erase",
      bbox: "1 2 3 4",
    });
    expect(mockedUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        mime: "image/jpeg",
        filename: expect.stringMatching(/^illu-edit-.+\.jpg$/),
      }),
    );
  });
});

describe("enqueueIllustrationEdit(M47 批 A 队列化)", () => {
  it("入队:edit job 名 + attempts=1 计费不重试 + illu-edit- 前缀 jobId(非确定性)", async () => {
    queueAdd.mockResolvedValueOnce(undefined);
    const { jobId } = await enqueueIllustrationEdit({
      versionId: BigInt(12),
      imagePath: "/wp-content/uploads/a.png",
      mode: "text",
      bbox: "1 2 3 4",
      instruction: "改标题",
    });
    expect(jobId).toMatch(/^illu-edit-[a-z0-9]+$/);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [name, data, opts] = queueAdd.mock.calls[0];
    expect(name).toBe("edit");
    expect(data).toEqual({
      versionId: "12",
      imagePath: "/wp-content/uploads/a.png",
      mode: "text",
      bbox: "1 2 3 4",
      instruction: "改标题",
    });
    expect(opts).toMatchObject({ jobId, attempts: 1 });
  });

  it("未绑定模型:入队即人话拒(job 内失败用户看不见)", async () => {
    const { resolveAiModel } = await import("./resolver");
    vi.mocked(resolveAiModel).mockResolvedValueOnce(null);
    await expect(
      enqueueIllustrationEdit({
        versionId: BigInt(12),
        imagePath: "/wp-content/uploads/a.png",
        mode: "erase",
        bbox: "1 2 3 4",
      }),
    ).rejects.toThrow(AiAdminError);
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

describe("illustrationEditJobStatus(任务态转译)", () => {
  it("job 不存在 → missing(removeOn* 滚动清除/过期)", async () => {
    queueGetJob.mockResolvedValueOnce(null);
    await expect(illustrationEditJobStatus("illu-edit-x")).resolves.toEqual({ state: "missing" });
  });

  it("completed+有结果 → done 候选路径;failed → failedReason 人话;在途 → processing", async () => {
    queueGetJob.mockResolvedValueOnce({
      getState: async () => "completed",
      returnvalue: { imagePath: "/wp-content/uploads/2026/10/edit.png" },
    });
    await expect(illustrationEditJobStatus("illu-edit-x")).resolves.toEqual({
      state: "done",
      imagePath: "/wp-content/uploads/2026/10/edit.png",
    });

    queueGetJob.mockResolvedValueOnce({
      getState: async () => "failed",
      failedReason: "编辑返回了空结果(契约漂移,检查供应商与模型 ID)",
    });
    await expect(illustrationEditJobStatus("illu-edit-x")).resolves.toEqual({
      state: "failed",
      message: "编辑返回了空结果(契约漂移,检查供应商与模型 ID)",
    });

    queueGetJob.mockResolvedValueOnce({ getState: async () => "active" });
    await expect(illustrationEditJobStatus("illu-edit-x")).resolves.toEqual({
      state: "processing",
    });
  });
});
