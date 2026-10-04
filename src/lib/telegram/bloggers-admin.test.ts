/**
 * 博主台账手动触发单测(批⑧):db/queue/logger/网关适配器/平台行全打桩,
 * 验回填入队形状(job data backfill=true、jobId 前缀)与前置校验三判。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  socialAccount: {
    findUnique: vi.fn<(args?: unknown) => Promise<unknown>>(),
    findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []),
  },
}));
vi.mock("../db", () => ({ prisma: prismaMock }));

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const queueMock = vi.hoisted(() => ({
  add: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
}));
vi.mock("../queue", () => ({ QUEUE_CRAWLER: "crawler", getQueue: () => queueMock }));

vi.mock("./adapters/video/douyin", () => ({
  fetchDouyinProfile: vi.fn(),
  resolveDouyinSecUid: vi.fn(),
}));

vi.mock("./social-platform-admin", () => ({
  activeJars: vi.fn(async () => []),
  ensurePlatformRow: vi.fn(async () => ({ id: 10 })),
}));

import {
  triggerBloggerBackfill,
  triggerBloggerCrawl,
  type BloggerAdminErrorCode,
} from "./bloggers-admin";

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
