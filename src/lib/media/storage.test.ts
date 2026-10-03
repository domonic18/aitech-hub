import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { MEDIA_DIR: "/tmp/ah-media-unused" } }));

import { LocalDiskProvider, relToUploadsUrl, uploadsUrlToRel } from "./storage";

describe("uploadsUrlToRel / relToUploadsUrl(URL ↔ 磁盘名同构)", () => {
  it("合法 URL 剥前缀;percent-encoding 原样保留(不 decode,与盘上文件名逐字节同构)", () => {
    expect(uploadsUrlToRel("/wp-content/uploads/2026/09/abc.png")).toBe("2026/09/abc.png");
    expect(uploadsUrlToRel("/wp-content/uploads/2024/01/%E4%B8%AD%E6%96%87.png")).toBe(
      "2024/01/%E4%B8%AD%E6%96%87.png",
    );
    expect(uploadsUrlToRel("/wp-content/uploads/2024/01/%e4%b8%ad%e6%96%87.png")).toBe(
      "2024/01/%e4%b8%ad%e6%96%87.png", // 小写 hex 原样(生产库/闭包的规范形态)
    );
    const round = relToUploadsUrl("2026/09/a%20b.png");
    expect(round).toBe("/wp-content/uploads/2026/09/a%2520b.png"); // 段内 % 自身被编码(新上传为 sha1 ASCII 名,不受影响)
    expect(relToUploadsUrl("2024/01/中文.png")).toBe(
      "/wp-content/uploads/2024/01/%E4%B8%AD%E6%96%87.png",
    );
  });

  it("非站内前缀/穿越/字面 NUL → null", () => {
    expect(uploadsUrlToRel("/media/videos/a.mp4")).toBeNull();
    expect(uploadsUrlToRel("https://cdn.com/a.png")).toBeNull();
    expect(uploadsUrlToRel("/wp-content/uploads/../../etc/passwd")).toBeNull();
    expect(uploadsUrlToRel("/wp-content/uploads/a\0b.png")).toBeNull();
  });
});

describe("LocalDiskProvider(临时根目录实测)", () => {
  let root = "";
  let store: LocalDiskProvider;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ah-media-test-"));
    store = new LocalDiskProvider(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("put/get/exists/size/delete 全链路;目录自动创建", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    await store.put("2026/09/x.png", data);
    expect(await store.exists("2026/09/x.png")).toBe(true);
    expect(await store.size("2026/09/x.png")).toBe(4);
    expect(await store.get("2026/09/x.png")).toEqual(Buffer.from(data));
    await store.delete("2026/09/x.png");
    expect(await store.exists("2026/09/x.png")).toBe(false);
  });

  it("get/size 缺文件返回 null(不抛)", async () => {
    expect(await store.get("no/such.png")).toBeNull();
    expect(await store.size("no/such.png")).toBeNull();
  });

  it("越界路径(穿越根目录):写/删抛错,读返回 null 不泄数据", async () => {
    await expect(store.put("../escape.png", new Uint8Array([1]))).rejects.toThrow(/非法存储路径/);
    expect(await store.get("../escape.png")).toBeNull(); // abs 抛错被 get 捕获 → null
    await expect(store.delete("../escape.png")).rejects.toThrow(/非法存储路径/);
  });
});
