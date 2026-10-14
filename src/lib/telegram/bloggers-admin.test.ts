/**
 * 博主台账手动触发单测(批⑧):db/queue/logger/网关适配器/平台行全打桩,
 * 验回填入队形状(job data backfill=true、jobId 前缀)与前置校验三判。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  socialAccount: {
    findUnique: vi.fn<(args?: unknown) => Promise<unknown>>(),
    findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []),
    create: vi.fn<(args?: unknown) => Promise<unknown>>(async () => ({ id: 77 })),
  },
  // 出口代理单例(M33 批B):默认未配置(findUnique→null)= 直连
  systemProxyConfig: {
    findUnique: vi.fn<(args?: unknown) => Promise<unknown>>(async () => null),
  },
}));
vi.mock("../db", () => ({
  prisma: prismaMock,
  // 镜像真实 P2002 判定(本体由 db 单测/使用方测试钉死)
  isP2002: (e: unknown) =>
    typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002",
}));

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const queueMock = vi.hoisted(() => ({
  add: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
}));
vi.mock("../queue", () => ({
  CRAWL_JOB_VIDEO: "crawl-video",
  QUEUE_CRAWLER: "crawler",
  getQueue: () => queueMock,
}));

vi.mock("./adapters/video/douyin", () => ({
  fetchDouyinProfile: vi.fn(),
  resolveDouyinSecUid: vi.fn(),
}));

vi.mock("./adapters/video/bilibili", () => ({
  fetchBilibiliProfile: vi.fn(),
  resolveBilibiliMid: vi.fn(),
}));

vi.mock("./social-platform-admin", () => ({
  activeJars: vi.fn(async () => ["jar-a"]),
  ensurePlatformRow: vi.fn(async () => ({ id: 10 })),
}));

import {
  createBlogger,
  triggerBloggerBackfill,
  triggerBloggerCrawl,
  type BloggerAdminErrorCode,
} from "./bloggers-admin";
import { fetchBilibiliProfile, resolveBilibiliMid } from "./adapters/video/bilibili";
import { fetchDouyinProfile, resolveDouyinSecUid } from "./adapters/video/douyin";
import { activeJars, ensurePlatformRow } from "./social-platform-admin";

function crawlable(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    enabled: true,
    nickname: "AI 前沿",
    platformRow: { enabled: true },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("triggerBloggerBackfill 手动回填(批⑧)", () => {
  it("入队 crawl-video,data 带 backfill:true,jobId 前缀 crawl-video-{id}-backfill-", async () => {
    prismaMock.socialAccount.findUnique.mockResolvedValue(crawlable());
    await expect(triggerBloggerBackfill(1)).resolves.toEqual({ enqueued: true });
    expect(queueMock.add).toHaveBeenCalledWith(
      "crawl-video",
      { accountId: 1, backfill: true },
      expect.objectContaining({ jobId: expect.stringMatching(/^crawl-video-1-backfill-/) }),
    );
  });

  it("博主不存在 → not_found", async () => {
    prismaMock.socialAccount.findUnique.mockResolvedValue(null);
    await expect(triggerBloggerBackfill(1)).rejects.toMatchObject({
      code: "not_found",
    } satisfies { code: BloggerAdminErrorCode });
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it("博主停用 → disabled,不入队", async () => {
    prismaMock.socialAccount.findUnique.mockResolvedValue(crawlable({ enabled: false }));
    await expect(triggerBloggerBackfill(1)).rejects.toMatchObject({
      code: "disabled",
    } satisfies { code: BloggerAdminErrorCode });
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it("平台总开关关闭 → disabled,不入队", async () => {
    prismaMock.socialAccount.findUnique.mockResolvedValue(
      crawlable({ platformRow: { enabled: false } }),
    );
    await expect(triggerBloggerBackfill(1)).rejects.toMatchObject({
      code: "disabled",
    } satisfies { code: BloggerAdminErrorCode });
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it("triggerBloggerCrawl 的 job data 不含 backfill 键(既有形状不变)", async () => {
    prismaMock.socialAccount.findUnique.mockResolvedValue(crawlable());
    await triggerBloggerCrawl(1);
    expect(queueMock.add).toHaveBeenCalledWith(
      "crawl-video",
      { accountId: 1 },
      expect.objectContaining({ jobId: expect.stringMatching(/^crawl-video-1-manual-/) }),
    );
  });
});

describe("createBlogger 登记分发(M24 per-platform)", () => {
  it("bilibili:space 链接直提 mid(不经 resolve),profile/平台行走 B站分发", async () => {
    vi.mocked(fetchBilibiliProfile).mockResolvedValue({
      secUid: "9469941",
      nickname: "AI 技术漫谈",
      avatarUrl: "https://i0.hdslb.com/bfs/face/a.jpg",
    });
    const created = await createBlogger({
      platform: "bilibili",
      input: "https://space.bilibili.com/9469941?spm=x",
      nickname: "",
    });
    expect(created).toEqual({ id: 77 });
    expect(resolveBilibiliMid).not.toHaveBeenCalled(); // 链接已含 mid
    expect(fetchBilibiliProfile).toHaveBeenCalledWith("9469941", ["jar-a"], undefined);
    expect(ensurePlatformRow).toHaveBeenCalledWith("bilibili");
    expect(activeJars).toHaveBeenCalledWith("bilibili");
    expect(prismaMock.socialAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ platform: "bilibili", secUid: "9469941" }),
      select: { id: true },
    });
  });

  it("bilibili:裸 mid 直用;b23.tv 短链走网关 /resolve", async () => {
    vi.mocked(fetchBilibiliProfile).mockResolvedValue({
      secUid: "9469941",
      nickname: "漫谈",
      avatarUrl: null,
    });
    await createBlogger({ platform: "bilibili", input: "9469941" });
    expect(resolveBilibiliMid).not.toHaveBeenCalled();

    vi.mocked(resolveBilibiliMid).mockResolvedValue("9469941");
    await createBlogger({ platform: "bilibili", input: "https://b23.tv/abc/" });
    expect(resolveBilibiliMid).toHaveBeenCalledWith("https://b23.tv/abc/", undefined);
  });

  it("douyin(缺省平台):sec_uid 提取与 profile 分发不变(回归)", async () => {
    vi.mocked(fetchDouyinProfile).mockResolvedValue({
      secUid: "MS4wLjABAAAA1234567890abcdefghij",
      nickname: "AI 前沿",
      avatarUrl: null,
    });
    await createBlogger({
      platform: "douyin",
      input: "https://www.douyin.com/user/MS4wLjABAAAA1234567890abcdefghij",
    });
    expect(fetchDouyinProfile).toHaveBeenCalledWith(
      "MS4wLjABAAAA1234567890abcdefghij",
      ["jar-a"],
      undefined,
    );
    expect(ensurePlatformRow).toHaveBeenCalledWith("douyin");
    expect(prismaMock.socialAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        platform: "douyin",
        secUid: "MS4wLjABAAAA1234567890abcdefghij",
      }),
      select: { id: true },
    });
  });
});
