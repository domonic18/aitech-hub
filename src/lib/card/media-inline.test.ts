/**
 * 站内引图内联单测(M31 COS 引图补丁):src/url() 两形态注入、去重、缺失即抛、
 * 超限 sharp 压缩(真 sharp:无压缩 PNG 喂入断言转 jpeg)、总量预算拒渲。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaGet = vi.hoisted(() => vi.fn());
vi.mock("../media/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../media/storage")>();
  return { ...actual, mediaStorage: { get: mediaGet } };
});

import { inlineSiteMediaRefs } from "./media-inline";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("inlineSiteMediaRefs", () => {
  it("无站内引用原样返回,不触存储", async () => {
    const html = '<img src="data:image/png;base64,AA=="><img src="https://x.com/y.png">';
    await expect(inlineSiteMediaRefs(html)).resolves.toBe(html);
    expect(mediaGet).not.toHaveBeenCalled();
  });

  it("img src 站内路径 → data URI 注入", async () => {
    mediaGet.mockResolvedValueOnce(PNG_BYTES);
    const out = await inlineSiteMediaRefs('<img src="/wp-content/uploads/2026/10/a.png">');
    expect(out).toBe(`<img src="data:image/png;base64,${PNG_BYTES.toString("base64")}">`);
    expect(mediaGet).toHaveBeenCalledWith("2026/10/a.png");
  });

  it("css url() 站内路径同样注入", async () => {
    mediaGet.mockResolvedValueOnce(PNG_BYTES);
    const out = await inlineSiteMediaRefs(
      "<style>.a{background:url(/wp-content/uploads/b.webp)}</style>",
    );
    expect(out).toContain(`url(data:image/webp;base64,${PNG_BYTES.toString("base64")})`);
    expect(mediaGet).toHaveBeenCalledWith("b.webp");
  });

  it("重复路径存储只读一次,全部出现位均替换", async () => {
    mediaGet.mockResolvedValue(PNG_BYTES);
    const html =
      '<img src="/wp-content/uploads/x/a.png"><style>.b{background:url(/wp-content/uploads/x/a.png)}</style>';
    const out = await inlineSiteMediaRefs(html);
    expect(mediaGet).toHaveBeenCalledTimes(1);
    expect(out.match(/data:image\/png;base64,/g)).toHaveLength(2);
  });

  it("存储缺失即抛人话错(替代静默占位)", async () => {
    mediaGet.mockResolvedValueOnce(null);
    await expect(
      inlineSiteMediaRefs('<img src="/wp-content/uploads/2026/10/gone.png">'),
    ).rejects.toThrow("站内图片文件缺失:/wp-content/uploads/2026/10/gone.png");
  });

  it("越界路径(../)在存储读取前拦截", async () => {
    await expect(
      inlineSiteMediaRefs('<img src="/wp-content/uploads/../secret.png">'),
    ).rejects.toThrow("非法站内图片路径");
    expect(mediaGet).not.toHaveBeenCalled();
  });

  it("超限大图走 sharp 压缩成 jpeg(真 sharp 无压缩 PNG 喂入)", async () => {
    // 无压缩 PNG(compressionLevel 0):600×600 RGB 存储块 ≈1.08MB,必超 220KB
    const raw = Buffer.alloc(600 * 600 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7) % 256;
    const bigPng = await import("sharp").then((s) =>
      s
        .default(raw, { raw: { width: 600, height: 600, channels: 3 } })
        .png({ compressionLevel: 0 })
        .toBuffer(),
    );
    expect(bigPng.length).toBeGreaterThan(220 * 1024);
    mediaGet.mockResolvedValueOnce(bigPng);
    const out = await inlineSiteMediaRefs('<img src="/wp-content/uploads/2026/10/big.png">');
    expect(out).toMatch(/^<img src="data:image\/jpeg;base64,/);
    // 内联后仍须守住单图预算(base64 段 ≤ 300k 字符)
    expect(out.length).toBeLessThan(300_000);
  });

  it("data URI 总量超预算拒渲", async () => {
    mediaGet.mockResolvedValue(Buffer.alloc(200 * 1024, 1)); // 各 ≈273k base64 字符
    await expect(
      inlineSiteMediaRefs(
        '<img src="/wp-content/uploads/a.png"><img src="/wp-content/uploads/b.png">',
      ),
    ).rejects.toThrow("配图总量过大");
  });
});
