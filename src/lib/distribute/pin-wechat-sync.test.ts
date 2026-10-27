/**
 * 贴图公众号同步单测(prisma/队列/客户端/素材全 mock,网络必 mock 纪律):
 * 入队资格前置五分支(未配置/草稿未验收/缺图/pending 拒重零入队/重推放行)、
 * syncOnePin 管线(首推 add 分流 pending→synced、重推 update 锚定不动站点态、
 * 41039 去阅读原文重试一次、缺图/超 32 字/接口失败落 failed)、job 包装失败上抛。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  isP2002: (e: unknown) =>
    typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002",
  prisma: {
    contentPin: { findUnique: vi.fn(), update: vi.fn() },
    contentPinChannel: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") {
        // 批C 交互式事务:tx 路由到同一批 mock fn(markPinChannelSynced 走 tx 通道)
        return (arg as (t: unknown) => Promise<unknown>)(txClient);
      }
      return arg;
    }),
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../queue", () => ({
  QUEUE_DISTRIBUTE: "distribute",
  DISTRIBUTE_JOB_PIN_WECHAT: "pin-wechat-sync",
  getQueue: vi.fn(() => ({ add: addMock })),
}));
vi.mock("./wechat-sync", () => ({ requireReadyConfig: vi.fn() }));
vi.mock("./wechat-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./wechat-client")>()), // 保留真实 WechatApiError(纯类)
  wechatDraftAdd: vi.fn(),
  wechatDraftUpdate: vi.fn(),
}));
vi.mock("./wechat-media", () => ({ ensureCoverMedia: vi.fn() }));

import { prisma } from "../db";
import { DistributeError } from "./errors";
import { ensureCoverMedia } from "./wechat-media";
import {
  WechatApiError,
  wechatDraftAdd,
  wechatDraftUpdate,
  type WechatNewsPicArticle,
} from "./wechat-client";
import { requireReadyConfig } from "./wechat-sync";
import { enqueuePinWechatSync, pinWechatSyncJob, syncOnePin } from "./pin-wechat-sync";

const { addMock, txClient } = vi.hoisted(() => ({
  addMock: vi.fn(),
  txClient: {
    contentPinChannel: {
      update: vi.fn(),
    },
    contentPin: {
      update: vi.fn(),
    },
  },
}));

const mocked = {
  findPin: vi.mocked(prisma.contentPin.findUnique),
  updatePin: vi.mocked(prisma.contentPin.update),
  findChannel: vi.mocked(prisma.contentPinChannel.findUnique),
  createChannel: vi.mocked(prisma.contentPinChannel.create),
  updateChannel: vi.mocked(prisma.contentPinChannel.update),
  updateChannelMany: vi.mocked(prisma.contentPinChannel.updateMany),
  tx: vi.mocked(prisma.$transaction),
  cfg: vi.mocked(requireReadyConfig),
  cover: vi.mocked(ensureCoverMedia),
  draftAdd: vi.mocked(wechatDraftAdd),
  draftUpdate: vi.mocked(wechatDraftUpdate),
};

const CFG = { appid: "wxid", appSecret: "sec", author: "一起AI" };

function pinRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: BigInt(1),
    title: "标题",
    content: "轻文字",
    status: "pending",
    readMoreUrl: "https://17aitech.com/post/1-x/",
    cropSpec: "1_1",
    syncedAt: null,
    images: [
      {
        id: BigInt(11),
        pinId: BigInt(1),
        versionId: null,
        mediaPath: "/wp/a.webp",
        width: 800,
        height: 600,
        sortOrder: 0,
      },
    ],
    _count: { images: 1 },
    ...over,
  } as never;
}

function channelRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: BigInt(5),
    pinId: BigInt(1),
    channel: "wechat",
    status: "pending",
    mediaId: null,
    publishId: null,
    attempts: 0,
    lastError: null,
    syncedAt: null,
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.cfg.mockResolvedValue(CFG as never);
  mocked.updatePin.mockResolvedValue(pinRow());
  mocked.updateChannel.mockResolvedValue(channelRow());
  mocked.cover.mockResolvedValue({ mediaId: "M1" });
});

describe("enqueuePinWechatSync 资格前置", () => {
  it("未配置公众号 → DistributeError 直接透出", async () => {
    mocked.cfg.mockRejectedValue(new DistributeError("invalid", "公众号未配置"));
    await expect(enqueuePinWechatSync(BigInt(1))).rejects.toThrow(DistributeError);
    expect(addMock).not.toHaveBeenCalled();
  });

  it("草稿未验收 → invalid 人话点明先提交验收", async () => {
    mocked.findPin.mockResolvedValue(pinRow({ status: "draft" }));
    const err = await enqueuePinWechatSync(BigInt(1)).catch((e) => e as DistributeError);
    expect(err).toBeInstanceOf(DistributeError);
    expect((err as DistributeError).message).toContain("提交验收");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("缺图 → invalid 人话点明至少 1 张", async () => {
    mocked.findPin.mockResolvedValue(pinRow({ _count: { images: 0 } }));
    const err = (await enqueuePinWechatSync(BigInt(1)).catch((e) => e)) as DistributeError;
    expect(err.message).toContain("至少需要 1 张图");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("pending 拒重:建行前判,零入队零落行(防僵尸 pending 首单教训)", async () => {
    mocked.findPin.mockResolvedValue(pinRow());
    mocked.findChannel.mockResolvedValue(channelRow({ status: "pending" }));
    const err = (await enqueuePinWechatSync(BigInt(1)).catch((e) => e)) as DistributeError;
    expect((err as DistributeError).code).toBe("pending");
    expect(mocked.createChannel).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();
  });

  it("通过:入队 jobId 无冒号 + 渠道行落 pending;synced 重推放行", async () => {
    mocked.findPin.mockResolvedValue(pinRow());
    mocked.findChannel.mockResolvedValue(channelRow({ status: "synced", mediaId: "OLD" }));
    const r = await enqueuePinWechatSync(BigInt(1));
    expect(r.jobId).toMatch(/^pin-wechat-[a-z0-9]+$/);
    expect(addMock).toHaveBeenCalledWith(
      "pin-wechat-sync",
      { token: expect.any(String), pinId: "1" },
      expect.objectContaining({ attempts: 2 }),
    );
    expect(mocked.updateChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BigInt(5) },
        data: { status: "pending", lastError: null },
      }),
    );
  });
});

describe("syncOnePin 管线", () => {
  it("首推:逐张永久素材 + draft/add;pending→synced 落事务,载荷带阅读原文", async () => {
    mocked.findPin.mockResolvedValue(pinRow());
    mocked.findChannel.mockResolvedValue(channelRow({ status: "pending" }));
    mocked.draftAdd.mockResolvedValue("DRAFT_NEW");
    const r = await syncOnePin(BigInt(1));
    expect(r.ok).toBe(true);
    expect(r.mediaId).toBe("DRAFT_NEW");
    expect(mocked.draftAdd).toHaveBeenCalledTimes(1);
    const article = mocked.draftAdd.mock.calls[0][1] as WechatNewsPicArticle;
    expect(article.article_type).toBe("newspic");
    expect(article.image_info.image_list).toEqual([{ image_media_id: "M1" }]);
    expect(article.cover_info?.crop_percent_list).toEqual([{ ratio: "1_1" }]);
    expect(article.content_source_url).toContain("/post/1-x/");
    expect(mocked.tx).toHaveBeenCalledTimes(1);
    expect(txClient.contentPinChannel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "synced", mediaId: "DRAFT_NEW" }),
      }),
    );
    expect(txClient.contentPin.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BigInt(1) },
        data: expect.objectContaining({ status: "synced" }),
      }),
    );
  });

  it("重推:mediaId 锚定走 draft/update;已发布不动站点态", async () => {
    mocked.findPin.mockResolvedValue(pinRow({ status: "published" }));
    mocked.findChannel.mockResolvedValue(channelRow({ status: "synced", mediaId: "DRAFT_OLD" }));
    mocked.draftUpdate.mockResolvedValue(undefined);
    const r = await syncOnePin(BigInt(1));
    expect(r.ok).toBe(true);
    expect(mocked.draftUpdate).toHaveBeenCalledWith(
      { appid: "wxid", appSecret: "sec" }, // creds 只取 appid/appSecret(author 不进凭证)
      "DRAFT_OLD",
      expect.anything(),
    );
    expect(mocked.draftAdd).not.toHaveBeenCalled();
    expect(txClient.contentPin.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ status: expect.anything() }),
      }),
    );
  });

  it("41039 域名校验拒 → 去阅读原文重试一次(同图文口径)", async () => {
    mocked.findPin.mockResolvedValue(pinRow());
    mocked.findChannel.mockResolvedValue(channelRow({ status: "pending" }));
    mocked.draftAdd
      .mockRejectedValueOnce(new WechatApiError("config", 41039, "invalid content_source_url"))
      .mockResolvedValueOnce("DRAFT_RETRY");
    const r = await syncOnePin(BigInt(1));
    expect(r.ok).toBe(true);
    expect(mocked.draftAdd).toHaveBeenCalledTimes(2);
    const retried = mocked.draftAdd.mock.calls[1][1] as WechatNewsPicArticle;
    expect(retried.content_source_url).toBeUndefined();
  });

  it("缺图 → failed 落行人话,零微信调用;job 包装上抛", async () => {
    mocked.findPin.mockResolvedValue(pinRow({ images: [] }));
    mocked.findChannel.mockResolvedValue(channelRow({ status: "pending" }));
    const r = await syncOnePin(BigInt(1));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("至少需要 1 张图");
    expect(mocked.draftAdd).not.toHaveBeenCalled();
    expect(mocked.updateChannelMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pinId: BigInt(1), channel: "wechat" },
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
    await expect(pinWechatSyncJob({ token: "t", pinId: "1" })).rejects.toThrow("至少需要 1 张图");
  });

  it("标题超 32 码点 → failed 落行(同步侧兜底,不信任上游)", async () => {
    mocked.findPin.mockResolvedValue(pinRow({ title: "标".repeat(33) }));
    mocked.findChannel.mockResolvedValue(channelRow({ status: "pending" }));
    const r = await syncOnePin(BigInt(1));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("上限 32");
  });

  it("微信接口失败 → failed 落行返回不抛(attempts 由入队侧兜底)", async () => {
    mocked.findPin.mockResolvedValue(pinRow());
    mocked.findChannel.mockResolvedValue(channelRow({ status: "pending" }));
    mocked.draftAdd.mockRejectedValue(new WechatApiError("media", 40007, "invalid media_id"));
    const r = await syncOnePin(BigInt(1));
    expect(r.ok).toBe(false);
    expect(mocked.updatePin).not.toHaveBeenCalled();
    expect(mocked.updateChannelMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pinId: BigInt(1), channel: "wechat" },
        data: expect.objectContaining({ status: "failed", attempts: { increment: 1 } }),
      }),
    );
  });
});
