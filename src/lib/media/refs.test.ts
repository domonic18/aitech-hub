import { describe, expect, it, vi } from "vitest";

import { extractMediaRefs, syncMediaRefs } from "./refs";

describe("extractMediaRefs(站内媒体路径提取,arch/08 §3.1)", () => {
  it("md 图片 + 旧文 HTML img/video + 封面一并收;去重", () => {
    const refs = extractMediaRefs({
      contentMd: "![a](/wp-content/uploads/2024/01/a.png)\n![b](/media/videos/b.mp4)",
      contentHtml: '<img src="/wp-content/uploads/2024/01/a.png"><video src="/media/videos/c.mp4">',
      coverPath: "/wp-content/uploads/2024/02/cover.jpg",
    });
    expect(refs).toEqual([
      "/wp-content/uploads/2024/01/a.png",
      "/media/videos/b.mp4",
      "/media/videos/c.mp4",
      "/wp-content/uploads/2024/02/cover.jpg",
    ]);
  });

  it("外链与相对路径不收;非站内前缀不收;percent-encoded 归一(小写转义)", () => {
    const refs = extractMediaRefs({
      contentMd: [
        "![外链](https://cdn.example.com/x.png)",
        "![相对](img/a.png)",
        "![其他](/assets/a.png)",
        "![编码](/wp-content/uploads/2024/01/%E4%B8%AD%E6%96%87.PNG)",
      ].join("\n"),
    });
    expect(refs).toEqual(["/wp-content/uploads/2024/01/%e4%b8%ad%e6%96%87.PNG"]);
  });

  it("空输入返回空数组;GFM 裸 URL 不收", () => {
    expect(extractMediaRefs({})).toEqual([]);
    expect(extractMediaRefs({ contentMd: "看 https://x.com/a.png 这个" })).toEqual([]);
  });
});

describe("syncMediaRefs(先删后插,事务内调用)", () => {
  it("deleteMany 后按序 createMany;空引用只删不插", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = { mediaRef: { deleteMany, createMany } };

    await syncMediaRefs(tx as never, BigInt(42), [
      "/wp-content/uploads/2024/01/a.png",
      "/media/videos/b.mp4",
    ]);
    expect(deleteMany).toHaveBeenCalledWith({ where: { postId: BigInt(42) } });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { mediaPath: "/wp-content/uploads/2024/01/a.png", postId: BigInt(42) },
        { mediaPath: "/media/videos/b.mp4", postId: BigInt(42) },
      ],
      skipDuplicates: true,
    });

    createMany.mockClear();
    await syncMediaRefs(tx as never, BigInt(42), []);
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(createMany).not.toHaveBeenCalled();
  });
});
