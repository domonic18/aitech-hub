import { describe, expect, it } from "vitest";

import {
  IMAGE_MIME_WHITELIST,
  MEDIA_LIMITS,
  mediaBatchDeleteSchema,
  mediaImportSchema,
  extByMime,
  formatBytes,
  parseKind,
  parseRefFilter,
} from "./media-schema";

describe("parseKind / parseRefFilter(RSC 入参兜底)", () => {
  it("合法值直通,非法/缺省回退默认", () => {
    expect(parseKind("image")).toBe("image");
    expect(parseKind("video")).toBe("video");
    expect(parseKind("file")).toBe("file");
    expect(parseKind("movie")).toBe("image");
    expect(parseKind(undefined)).toBe("image");

    expect(parseRefFilter("referenced")).toBe("referenced");
    expect(parseRefFilter("orphan")).toBe("orphan");
    expect(parseRefFilter("broken")).toBe("all");
    expect(parseRefFilter(undefined)).toBe("all");
  });
});

describe("extByMime(sha1 文件名扩展归一)", () => {
  it("jpeg 归一为 jpg;白名单外返回 null", () => {
    expect(extByMime("image/jpeg")).toBe("jpg");
    expect(extByMime("image/png")).toBe("png");
    expect(extByMime("image/webp")).toBe("webp");
    expect(extByMime("image/gif")).toBe("gif");
    expect(extByMime("image/svg+xml")).toBeNull();
    expect(extByMime("")).toBeNull();
  });
});

describe("formatBytes(统计卡口径)", () => {
  it("B/KB/MB/GB 边界", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });
});

describe("mediaImportSchema(外链转存边界)", () => {
  it("仅收 http(s);上限 30;空数组拒绝", () => {
    const ok = mediaImportSchema.safeParse({ urls: ["https://a.com/x.png"] });
    expect(ok.success).toBe(true);

    expect(mediaImportSchema.safeParse({ urls: ["ftp://a.com/x"] }).success).toBe(false);
    expect(mediaImportSchema.safeParse({ urls: ["not-a-url"] }).success).toBe(false);
    expect(mediaImportSchema.safeParse({ urls: [] }).success).toBe(false);
    expect(
      mediaImportSchema.safeParse({
        urls: Array.from({ length: MEDIA_LIMITS.maxBatchUrls + 1 }, (_, i) => `https://a.com/${i}`),
      }).success,
    ).toBe(false);
  });
});

describe("mediaBatchDeleteSchema(批量删除边界)", () => {
  it("id 必须是数字串;1..200 条", () => {
    expect(mediaBatchDeleteSchema.safeParse({ ids: ["1", "2"] }).success).toBe(true);
    expect(mediaBatchDeleteSchema.safeParse({ ids: ["abc"] }).success).toBe(false);
    expect(mediaBatchDeleteSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(
      mediaBatchDeleteSchema.safeParse({ ids: Array.from({ length: 201 }, () => "1") }).success,
    ).toBe(false);
  });
});

describe("白名单常量(arch/08 §3.4)", () => {
  it("一期仅图片,不含视频", () => {
    expect(IMAGE_MIME_WHITELIST).toEqual(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    expect(MEDIA_LIMITS.maxUploadBytes).toBe(10 * 1024 * 1024);
    expect(MEDIA_LIMITS.trashDays).toBe(7);
  });
});
