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
  sniffImageMime,
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

describe("sniffImageMime(魔数嗅探裁决,批⑦ 传参错误根治)", () => {
  it("四类白名单格式按字节识别,声明 mime 不参与裁决", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(sniffImageMime(jpeg)).toBe("image/jpeg");
    expect(sniffImageMime(png)).toBe("image/png");
    expect(sniffImageMime(webp)).toBe("image/webp");
    expect(sniffImageMime(gif)).toBe("image/gif");
  });

  it("垃圾字节/截断魔数/空字节返回 null(调用方拒收)", () => {
    expect(sniffImageMime(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull(); // <svg 文本
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8]))).toBeNull(); // jpeg 魔数截断
    expect(
      sniffImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x53])),
    ).toBeNull(); // RIFF-AVIS 非 webp
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });
});
