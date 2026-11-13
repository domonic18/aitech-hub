/**
 * .md 整包上传单测(M71):图文按名匹配 → 上传入库 → 引用替换 → 落草稿。
 * 网络/IO 全部打桩(uploadMedia 与 upsertArticle),只测本域的匹配与替换口径。
 */
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  uploadMedia: vi.fn(),
  upsertArticle: vi.fn(),
}));

vi.mock("@/lib/media/service", () => ({ uploadMedia: hoisted.uploadMedia }));
vi.mock("./publish-api", () => ({ upsertArticle: hoisted.upsertArticle }));

import { importMdBundle } from "./bundle-import";

const ACTOR = { kind: "pat", sub: "7", patId: "3" } as const;

function reset(): void {
  hoisted.uploadMedia.mockReset();
  hoisted.upsertArticle.mockReset();
  hoisted.uploadMedia.mockImplementation(async (i: { filename: string }) => ({
    id: "1",
    path: `/wp-content/uploads/2026/11/${i.filename}`,
    reused: false,
    status: "processing",
  }));
  hoisted.upsertArticle.mockResolvedValue({
    action: "created",
    id: "9",
    slug: "demo",
    url: "/post/9-demo/",
    status: "draft",
    uploads: [],
    external: [],
  });
}

describe("importMdBundle", () => {
  it("本地引用按文件名匹配附件并替换为站内路径;外链保留原链", async () => {
    reset();
    const md = [
      "---",
      "title: 演示",
      "---",
      "正文 ![](./截图/a.png) 外链 ![](https://example.com/b.png)",
    ].join("\n");
    const result = await importMdBundle({
      md,
      files: [{ name: "a.png", mime: "image/png", data: new Uint8Array([1]) }],
      actor: ACTOR,
    });
    const passed = hoisted.upsertArticle.mock.calls[0]![0] as { markdown: string };
    expect(passed.markdown).toContain("](/wp-content/uploads/2026/11/a.png)");
    expect(passed.markdown).toContain("](https://example.com/b.png)");
    // 外链不进 uploads 清单
    expect(result.uploads.map((u) => u.src)).toEqual(["./截图/a.png"]);
  });

  it("未匹配到附件的本地引用保留原链并给出原因(不静默丢图)", async () => {
    reset();
    const result = await importMdBundle({
      md: "![](./missing.png)",
      files: [],
      actor: ACTOR,
    });
    expect(result.uploads).toEqual([
      { src: "./missing.png", path: null, reason: "no_matching_file" },
    ]);
    const passed = hoisted.upsertArticle.mock.calls[0]![0] as { markdown: string };
    expect(passed.markdown).toContain("](./missing.png)");
  });

  it("已是站内路径的引用不再上传(整包先传后写的图不重复入库)", async () => {
    reset();
    const result = await importMdBundle({
      md: "![](/wp-content/uploads/2026/01/x.png)",
      files: [],
      actor: ACTOR,
    });
    expect(hoisted.uploadMedia).not.toHaveBeenCalled();
    expect(result.uploads).toEqual([]);
  });

  it("frontmatter cover 指本地附件时一并入库并回填封面路径", async () => {
    reset();
    await importMdBundle({
      md: ["---", "title: 演示", "cover: ./cover.png", "---", "正文"].join("\n"),
      files: [{ name: "cover.png", mime: "image/png", data: new Uint8Array([1]) }],
      actor: ACTOR,
    });
    const passed = hoisted.upsertArticle.mock.calls[0]![0] as { coverPath?: string };
    expect(passed.coverPath).toBe("/wp-content/uploads/2026/11/cover.png");
  });

  it("上传失败:引用保留原链并记录原因,不中断整包发文", async () => {
    reset();
    hoisted.uploadMedia.mockRejectedValueOnce(new Error("too_large"));
    const result = await importMdBundle({
      md: "![](./a.png)",
      files: [{ name: "a.png", mime: "image/png", data: new Uint8Array([1]) }],
      actor: ACTOR,
    });
    expect(result.uploads[0]).toEqual({ src: "./a.png", path: null, reason: "too_large" });
    expect(hoisted.upsertArticle).toHaveBeenCalledTimes(1);
  });
});
