/**
 * 公众号同步编排单测(prisma/队列/客户端/存储/网络全 mock,网络必 mock 纪律):
 * 入队三口资格前置(未配置/旧文/缺封面/pending)、批量预检 skipped、自动钩子四分支、
 * syncOnePost 管线(首推 add/重推 update 分流、转存缓存命中零上传、WebP→JPEG、
 * 超限不截断、单图失败整篇终止)、批量进度与失败隔离。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  isP2002: (e: unknown) =>
    typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002",
  prisma: {
    post: { findUnique: vi.fn(), findMany: vi.fn() },
    publishChannel: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    publishMediaCache: { findUnique: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../queue", () => ({
  QUEUE_DISTRIBUTE: "distribute",
  DISTRIBUTE_JOB_WECHAT: "wechat-sync",
  DISTRIBUTE_JOB_WECHAT_BATCH: "wechat-batch",
  getQueue: vi.fn(() => ({ add: addMock })),
}));
vi.mock("./wechat-config-admin", () => ({
  getWechatRuntimeConfig: vi.fn(),
}));
vi.mock("./wechat-client", () => ({
  wechatAddCoverMaterial: vi.fn(),
  wechatDraftAdd: vi.fn(),
  wechatDraftUpdate: vi.fn(),
  wechatUploadImage: vi.fn(),
}));
vi.mock("../media/fetch-external", () => ({ fetchExternalImage: vi.fn() }));
vi.mock("../media/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../media/storage")>()),
  mediaStorage: { get: vi.fn() },
}));
vi.mock("sharp", () => ({
  default: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from("fake-jpeg") }) }),
}));

import { prisma } from "../db";
import { logger } from "../logger";

const { addMock } = vi.hoisted(() => ({ addMock: vi.fn() }));
import { fetchExternalImage } from "../media/fetch-external";
import { mediaStorage } from "../media/storage";
import {
  wechatAddCoverMaterial,
  wechatDraftAdd,
  wechatDraftUpdate,
  wechatUploadImage,
} from "./wechat-client";
import { getWechatRuntimeConfig } from "./wechat-config-admin";
import {
  enqueueWechatBatch,
  enqueueWechatSync,
  maybeEnqueueAutoWechat,
  type WechatSyncOverrides,
} from "./wechat-sync";
import { syncOnePost, wechatBatchJob } from "./wechat-sync-run";

const mockedPost = vi.mocked(prisma.post);
const mockedChannel = vi.mocked(prisma.publishChannel);
const mockedCache = vi.mocked(prisma.publishMediaCache);
const mockedStorageGet = vi.mocked(mediaStorage.get);
const mockedFetchExternal = vi.mocked(fetchExternalImage);
const mockedAdd = addMock;
const mockedConfig = vi.mocked(getWechatRuntimeConfig);
const mockedDraftAdd = vi.mocked(wechatDraftAdd);
const mockedDraftUpdate = vi.mocked(wechatDraftUpdate);
const mockedUpload = vi.mocked(wechatUploadImage);
const mockedAddCover = vi.mocked(wechatAddCoverMaterial);

const READY_CFG = {
  enabled: true,
  autoSyncEnabled: true,
  appid: "wx123",
  appSecret: "sec",
  author: "一起AI",
  theme: "default",
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]);
const WEBP = new Uint8Array(Buffer.from("RIFF0000WEBP0000"));

function channelRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: BigInt(7),
    postId: BigInt(101),
    channel: "wechat",
    status: "failed",
    mediaId: null,
    title: null,
    digest: null,
    thumbPath: null,
    attempts: 0,
    lastError: null,
    syncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function mdPost(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: BigInt(101),
    slug: "hello",
    title: "文章标题",
    seoTitle: null,
    excerpt: "文章摘要",
    seoDescription: null,
    coverPath: "/wp-content/uploads/2026/01/cover.png",
    contentMd: "正文一段![图](/wp-content/uploads/2026/01/img.png)",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedConfig.mockResolvedValue(READY_CFG);
  mockedStorageGet.mockResolvedValue(Buffer.from(PNG));
  mockedCache.findUnique.mockResolvedValue(null);
  mockedChannel.findUnique.mockResolvedValue(channelRow() as never);
  mockedAddCover.mockResolvedValue({ mediaId: "COVER1", url: "https://mmbiz/cover.png" });
  mockedUpload.mockResolvedValue("https://mmbiz/img.png");
  mockedDraftAdd.mockResolvedValue("DRAFT1");
});

describe("enqueueWechatSync 资格前置", () => {
  it("渠道未就绪 → disabled(400);不产生 job", async () => {
    mockedConfig.mockResolvedValueOnce({ ...READY_CFG, enabled: false });
    await expect(enqueueWechatSync(BigInt(101))).rejects.toMatchObject({ code: "disabled" });
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it("文章不存在 → not_found;旧文(无 contentMd)→ invalid;缺封面 → invalid", async () => {
    mockedPost.findUnique.mockResolvedValueOnce(null);
    await expect(enqueueWechatSync(BigInt(101))).rejects.toMatchObject({ code: "not_found" });

    mockedPost.findUnique.mockResolvedValueOnce(mdPost({ contentMd: null }) as never);
    await expect(enqueueWechatSync(BigInt(101))).rejects.toMatchObject({ code: "invalid" });

    mockedPost.findUnique.mockResolvedValueOnce(mdPost({ coverPath: null }) as never);
    await expect(enqueueWechatSync(BigInt(101))).rejects.toMatchObject({ code: "invalid" });
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it("行 pending → 拒绝入队(幂等)", async () => {
    mockedPost.findUnique.mockResolvedValue(mdPost() as never);
    mockedChannel.findUnique.mockResolvedValue(channelRow({ status: "pending" }) as never);
    await expect(enqueueWechatSync(BigInt(101))).rejects.toMatchObject({ code: "pending" });
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it("成功:job 载荷 postId 串+jobId 禁冒号;行置 pending 清 lastError", async () => {
    mockedPost.findUnique.mockResolvedValue(mdPost() as never);
    const overrides: WechatSyncOverrides = { title: "微调标题" };
    const r = await enqueueWechatSync(BigInt(101), overrides);
    expect(r.token).toBeTruthy();
    expect(mockedAdd).toHaveBeenCalledTimes(1);
    const [jobName, data, opts] = mockedAdd.mock.calls[0];
    expect(jobName).toBe("wechat-sync");
    expect(data).toMatchObject({ postId: "101", overrides });
    expect(String(opts?.jobId)).not.toContain(":");
    expect(mockedChannel.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "pending", lastError: null } }),
    );
  });

  it("覆盖值边界:title 空/超 64 字 → invalid", async () => {
    await expect(enqueueWechatSync(BigInt(101), { title: "" })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(enqueueWechatSync(BigInt(101), { title: "标".repeat(65) })).rejects.toMatchObject({
      code: "invalid",
    });
    expect(mockedAdd).not.toHaveBeenCalled();
  });
});

describe("enqueueWechatBatch 预检", () => {
  const ids = ["101", "102", "103", "104", "404"];

  it("空列表/超上限 → invalid", async () => {
    await expect(enqueueWechatBatch([])).rejects.toMatchObject({ code: "invalid" });
    await expect(
      enqueueWechatBatch(Array.from({ length: 31 }, (_, i) => String(i))),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("旧文/缺封面/pending/不存在 逐篇 skipped;合格者单 job 入队", async () => {
    mockedPost.findMany.mockResolvedValueOnce([
      mdPost({ id: BigInt(101) }) as never,
      mdPost({ id: BigInt(102), contentMd: null }) as never,
      mdPost({ id: BigInt(103), coverPath: null }) as never,
      mdPost({ id: BigInt(104) }) as never,
    ] as never);
    mockedChannel.findMany.mockResolvedValueOnce([
      { postId: BigInt(104), status: "pending" },
    ] as never);
    const r = await enqueueWechatBatch(ids);
    expect(r.eligible).toEqual(["101"]);
    expect(r.skipped).toEqual([
      { id: "102", reason: "旧文(HTML 保真)不支持" },
      { id: "103", reason: "缺少封面" },
      { id: "104", reason: "已在同步队列中" },
      { id: "404", reason: "文章不存在" },
    ]);
    expect(mockedAdd).toHaveBeenCalledTimes(1);
    const [, data] = mockedAdd.mock.calls[0];
    expect(data).toMatchObject({ ids: ["101"] });
    expect(mockedChannel.updateMany).toHaveBeenCalledTimes(1);
  });

  it("全部 skipped → 不产生 job 与 updateMany", async () => {
    mockedPost.findMany.mockResolvedValueOnce([
      mdPost({ id: BigInt(101), coverPath: null }) as never,
    ]);
    mockedChannel.findMany.mockResolvedValueOnce([]);
    const r = await enqueueWechatBatch(["101"]);
    expect(r.eligible).toEqual([]);
    expect(mockedAdd).not.toHaveBeenCalled();
    expect(mockedChannel.updateMany).not.toHaveBeenCalled();
  });
});

describe("maybeEnqueueAutoWechat 自动钩子", () => {
  it("渠道关/自动关 → 静默跳过", async () => {
    mockedConfig.mockResolvedValue({ ...READY_CFG, enabled: false });
    await maybeEnqueueAutoWechat(BigInt(101));
    mockedConfig.mockResolvedValue({ ...READY_CFG, autoSyncEnabled: false });
    await maybeEnqueueAutoWechat(BigInt(101));
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it("旧文/缺封面 → 静默跳过", async () => {
    mockedPost.findUnique.mockResolvedValue(mdPost({ contentMd: null }) as never);
    await maybeEnqueueAutoWechat(BigInt(101));
    mockedPost.findUnique.mockResolvedValue(mdPost({ coverPath: null }) as never);
    await maybeEnqueueAutoWechat(BigInt(101));
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it("行 synced/pending → 不自动重推(synced 防覆盖公众号侧人工微调)", async () => {
    mockedPost.findUnique.mockResolvedValue(mdPost() as never);
    mockedChannel.findUnique.mockResolvedValue({ status: "synced" } as never);
    await maybeEnqueueAutoWechat(BigInt(101));
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it("行 failed/缺失 → 入队;异常只 warn 不抛(不影响发布)", async () => {
    mockedPost.findUnique.mockResolvedValue(mdPost() as never);
    mockedChannel.findUnique.mockResolvedValue({ status: "failed" } as never);
    await maybeEnqueueAutoWechat(BigInt(101));
    expect(mockedAdd).toHaveBeenCalledTimes(1);

    mockedChannel.findUnique.mockResolvedValue(null);
    mockedAdd.mockRejectedValueOnce(new Error("redis down"));
    await expect(maybeEnqueueAutoWechat(BigInt(101))).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "wechat.auto_enqueue_failed" }),
    );
  });
});

describe("syncOnePost 管线", () => {
  it("首推:封面 add_material + 正文图 uploadimg + draft/add,行落 synced 快照", async () => {
    mockedPost.findUnique.mockResolvedValue(mdPost() as never);
    const r = await syncOnePost(BigInt(101));
    expect(r.ok).toBe(true);
    expect(r.mediaId).toBe("DRAFT1");
    expect(mockedAddCover).toHaveBeenCalledWith(
      expect.objectContaining({ appid: "wx123" }),
      PNG,
      "image.png",
      "image/png",
    );
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedDraftAdd).toHaveBeenCalledTimes(1);
    const article = mockedDraftAdd.mock.calls[0][1];
    expect(article.title).toBe("文章标题"); // title=缺省(无 seoTitle/快照)
    expect(article.digest).toBe("文章摘要"); // excerpt 回退
    expect(article.thumb_media_id).toBe("COVER1");
    expect(article.content).toContain("https://mmbiz/img.png"); // 图链已替换
    expect(article.content).not.toContain("/wp-content/uploads");
    expect(article.content_source_url).toContain("/post/101-hello");
    const data = mockedChannel.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toMatchObject({
      status: "synced",
      mediaId: "DRAFT1",
      thumbPath: mdPost().coverPath,
    });
  });

  it("重推:行有 mediaId → draft/update,draft/add 不调", async () => {
    mockedPost.findUnique.mockResolvedValue(mdPost() as never);
    mockedChannel.findUnique.mockResolvedValue(
      channelRow({ status: "synced", mediaId: "DRAFT1" }) as never,
    );
    const r = await syncOnePost(BigInt(101));
    expect(r.ok).toBe(true);
    expect(mockedDraftUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "DRAFT1",
      expect.objectContaining({ title: "文章标题" }),
    );
    expect(mockedDraftAdd).not.toHaveBeenCalled();
  });

  it("转存缓存命中 → 零上传,正文直用 mmbiz 缓存", async () => {
    mockedPost.findUnique.mockResolvedValue(
      mdPost({ contentMd: "![图](/wp-content/uploads/2026/01/img.png)" }) as never,
    );
    // 仅正文图(b: 前缀)命中缓存;封面(m:)仍走 add_material
    mockedCache.findUnique.mockImplementation((async (arg: unknown) => {
      const sourceKey = (arg as { where?: { channel_sourceKey?: { sourceKey?: string } } }).where
        ?.channel_sourceKey?.sourceKey;
      return sourceKey?.startsWith("b:")
        ? ({
            id: BigInt(1),
            channel: "wechat",
            sourceKey: "b:x",
            sourceUrl: null,
            remoteUrl: "https://mmbiz/cached.png",
            remoteMediaId: null,
            createdAt: new Date(),
          } as never)
        : null;
    }) as never);
    await syncOnePost(BigInt(101));
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(mockedDraftAdd.mock.calls[0][1].content).toContain("https://mmbiz/cached.png");
  });

  it("WebP 封面 → sharp 转 JPEG 再传(微信不收 webp)", async () => {
    mockedPost.findUnique.mockResolvedValue(
      mdPost({
        contentMd: "无图正文",
        coverPath: "/wp-content/uploads/2026/01/cover.webp",
      }) as never,
    );
    mockedStorageGet.mockResolvedValue(Buffer.from(WEBP));
    await syncOnePost(BigInt(101));
    expect(mockedAddCover).toHaveBeenCalledWith(
      expect.anything(),
      new Uint8Array(Buffer.from("fake-jpeg")),
      "image.jpg",
      "image/jpeg",
    );
  });

  it("外链正文图 → fetchExternalImage 下载后 uploadimg", async () => {
    mockedPost.findUnique.mockResolvedValue(
      mdPost({ contentMd: "![外](https://ex.com/a.png)" }) as never,
    );
    mockedFetchExternal.mockResolvedValueOnce({ data: PNG, mime: "image/png" });
    const r = await syncOnePost(BigInt(101));
    expect(r.ok).toBe(true);
    expect(mockedFetchExternal).toHaveBeenCalledWith("https://ex.com/a.png");
    expect(mockedUpload).toHaveBeenCalledTimes(1);
  });

  it("正文图装载失败 → 整篇失败列 src 清单,draft 不调", async () => {
    mockedPost.findUnique.mockResolvedValue(mdPost() as never);
    mockedStorageGet
      .mockResolvedValueOnce(Buffer.from(PNG)) // 封面正常
      .mockResolvedValueOnce(null); // 正文图缺失
    const r = await syncOnePost(BigInt(101));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("转存失败");
    expect(r.reason).toContain("img.png");
    expect(mockedDraftAdd).not.toHaveBeenCalled();
    const data = mockedChannel.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe("failed");
  });

  it("正文超预算 → failed 报数不截断", async () => {
    const long = "字".repeat(21000);
    mockedPost.findUnique.mockResolvedValue(mdPost({ contentMd: long }) as never);
    const r = await syncOnePost(BigInt(101));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("码点");
    expect(mockedDraftAdd).not.toHaveBeenCalled();
  });

  it("标题快照超上限 → failed(行快照优先级高于文章字段)", async () => {
    mockedPost.findUnique.mockResolvedValue(mdPost() as never);
    mockedChannel.findUnique.mockResolvedValue(channelRow({ title: "标".repeat(65) }) as never);
    const r = await syncOnePost(BigInt(101));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("上限 64");
  });
});

describe("syncOnePost 主题解析(M17 主题扩展)", () => {
  it("覆盖 > 行快照 > 渠道默认;生效主题随成功落行快照", async () => {
    mockedPost.findUnique.mockResolvedValue(mdPost() as never);
    mockedChannel.findUnique.mockResolvedValue(channelRow({ theme: "purple" }) as never);
    await syncOnePost(BigInt(101), { theme: "green" }); // 本次覆盖优先
    let data = mockedChannel.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.theme).toBe("green");

    mockedChannel.update.mockClear();
    await syncOnePost(BigInt(101)); // 无覆盖 → 行快照沿用(重推不改主题)
    data = mockedChannel.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.theme).toBe("purple");

    mockedChannel.update.mockClear();
    mockedChannel.findUnique.mockResolvedValue(channelRow({ theme: null }) as never);
    await syncOnePost(BigInt(101)); // 无快照 → 渠道默认
    data = mockedChannel.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.theme).toBe("default");
  });

  it("非法主题覆盖 → invalid 拒绝(入队前置;渲染回退只兜底落库脏值)", async () => {
    await expect(enqueueWechatSync(BigInt(101), { theme: "rainbow" })).rejects.toMatchObject({
      code: "invalid",
    });
  });
});

describe("wechatBatchJob 进度与失败隔离", () => {
  it("逐篇顺序 + 篇间 gap;单篇失败隔离记 failedIds", async () => {
    vi.useFakeTimers();
    try {
      mockedPost.findUnique
        .mockResolvedValueOnce(mdPost({ id: BigInt(101), contentMd: "无图" }) as never)
        .mockResolvedValueOnce(mdPost({ id: BigInt(102), contentMd: "无图" }) as never);
      mockedStorageGet.mockResolvedValueOnce(Buffer.from(PNG)).mockResolvedValueOnce(null); // 第二篇封面读盘失败
      const onProgress = vi.fn();
      const p = wechatBatchJob({ token: "t", ids: ["101", "102"] }, onProgress);
      await vi.advanceTimersByTimeAsync(2000); // 覆盖篇间 gap 1500ms
      const progress = await p;
      expect(progress.processed).toBe(2);
      expect(progress.failedIds).toEqual(["102"]);
      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(mockedDraftAdd).toHaveBeenCalledTimes(1); // 第一篇成功
    } finally {
      vi.useRealTimers();
    }
  });
});
