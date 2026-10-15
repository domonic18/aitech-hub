/**
 * 「复制公众号格式」执行侧单测(M31 批④,全 mock):管线产出(转存+渲染)、
 * 无码点门(超预算富稿照常 ok)、封面可选(无封面不阻塞)、主题解析三级
 * (覆盖 > 行快照 > 渠道默认)、失败降级(不抛,reason 人话)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    post: { findUnique: vi.fn() },
    publishChannel: { findUnique: vi.fn() },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./wechat-sync", () => ({
  requireReadyConfig: vi.fn(),
}));
vi.mock("./wechat-media", () => ({
  ensureCoverMedia: vi.fn(),
  transloadContentImages: vi.fn(),
}));
vi.mock("./wechat-html", () => ({
  renderWechatHtml: vi.fn(() => ({ html: "<section>渲染产物</section>", refs: [] })),
}));

import { prisma } from "../db";
import { requireReadyConfig } from "./wechat-sync";
import { ensureCoverMedia, transloadContentImages } from "./wechat-media";
import { renderWechatHtml } from "./wechat-html";
import { wechatCopyJob } from "./wechat-copy-run";

const mockedPost = vi.mocked(prisma.post);
const mockedChannel = vi.mocked(prisma.publishChannel);
const mockedConfig = vi.mocked(requireReadyConfig);
const mockedCover = vi.mocked(ensureCoverMedia);
const mockedTransload = vi.mocked(transloadContentImages);
const mockedRender = vi.mocked(renderWechatHtml);

const CFG = { appid: "wx-app", appSecret: "sec", theme: "blue" } as Awaited<
  ReturnType<typeof requireReadyConfig>
>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedConfig.mockResolvedValue(CFG);
  mockedChannel.findUnique.mockResolvedValue(null);
  mockedRender.mockReturnValue({ html: "<section>渲染产物</section>", refs: [] });
});

describe("wechatCopyJob 管线", () => {
  it("正常产出:封面入素材库+图片转存+渲染,ok/chars/coverReady 齐备", async () => {
    mockedPost.findUnique.mockResolvedValue({
      coverPath: "/wp-content/uploads/c.jpg",
      contentMd: "# 正文",
    } as never);
    mockedTransload.mockResolvedValue("转存后 md");
    mockedRender.mockReturnValue({ html: "<p>成品</p>", refs: [] });

    const r = await wechatCopyJob({ token: "t", postId: "156" });
    expect(r).toEqual({ ok: true, postId: "156", html: "<p>成品</p>", chars: 9, coverReady: true });
    expect(mockedCover).toHaveBeenCalledWith(
      { appid: "wx-app", appSecret: "sec" },
      "/wp-content/uploads/c.jpg",
    );
    // 渲染吃的是转存后 md,主题=渠道默认 blue(无行快照/覆盖)
    expect(mockedRender).toHaveBeenCalledWith("转存后 md", "blue");
  });

  it("无码点门:超预算富稿(远超 20000)照常 ok——本通道的存在意义", async () => {
    mockedPost.findUnique.mockResolvedValue({ coverPath: null, contentMd: "长文" } as never);
    mockedTransload.mockResolvedValue("长文");
    const big = "x".repeat(41_589);
    mockedRender.mockReturnValue({ html: big, refs: [] });

    const r = await wechatCopyJob({ token: "t", postId: "156" });
    expect(r.ok).toBe(true);
    expect(r.chars).toBe(41_589);
  });

  it("文章无封面:coverReady=false 但正文复制仍可用(封面人工处理)", async () => {
    mockedPost.findUnique.mockResolvedValue({ coverPath: null, contentMd: "md" } as never);
    mockedTransload.mockResolvedValue("md");

    const r = await wechatCopyJob({ token: "t", postId: "156" });
    expect(r.ok).toBe(true);
    expect(r.coverReady).toBe(false);
    expect(mockedCover).not.toHaveBeenCalled();
  });

  it("主题解析三级:覆盖 > 行快照 > 渠道默认", async () => {
    mockedPost.findUnique.mockResolvedValue({ coverPath: null, contentMd: "md" } as never);
    mockedChannel.findUnique.mockResolvedValue({ theme: "green" } as never);

    await wechatCopyJob({ token: "t", postId: "156" });
    expect(mockedRender).toHaveBeenLastCalledWith("md", "green"); // 行快照

    await wechatCopyJob({ token: "t", postId: "156", theme: "red" });
    expect(mockedRender).toHaveBeenLastCalledWith("md", "red"); // 本次覆盖
  });

  it("文章不存在/正文空:ok=false + 人话 reason", async () => {
    mockedPost.findUnique.mockResolvedValue(null);
    expect((await wechatCopyJob({ token: "t", postId: "99" })).ok).toBe(false);
    mockedPost.findUnique.mockResolvedValue({ coverPath: null, contentMd: "  " } as never);
    const r = await wechatCopyJob({ token: "t", postId: "156" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Markdown");
  });

  it("转存失败:降级 ok=false 不抛(人话进 reason)", async () => {
    mockedPost.findUnique.mockResolvedValue({
      coverPath: "/c.jpg",
      contentMd: "md",
    } as never);
    mockedCover.mockRejectedValue(new Error("微信 API 40001 凭证失效"));

    const r = await wechatCopyJob({ token: "t", postId: "156" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("40001");
  });
});
