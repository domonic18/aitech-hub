/**
 * 媒体迁移对账纯函数单测(M19 批③):清点(含 percent-encoded 原样/递归/缺目录)、
 * 差集三分类、确定性抽样。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { diffInventory, pickSamples, walkFiles } from "./media-inventory";

describe("walkFiles", () => {
  let root = "";

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ah-inv-test-"));
    await mkdir(path.join(root, "2024/04"), { recursive: true });
    await mkdir(path.join(root, "2026/09"), { recursive: true });
    await mkdir(path.join(root, "data"), { recursive: true });
    await writeFile(path.join(root, "2024/04/%E4%B8%AD%E6%96%87.png"), "a");
    await writeFile(path.join(root, "2026/09/abc.png"), "b");
    await writeFile(path.join(root, "data/626d.png"), "c");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("递归清点,相对 POSIX 路径,percent-encoded 原样不 decode,有序", async () => {
    await expect(walkFiles(root)).resolves.toEqual([
      "2024/04/%E4%B8%AD%E6%96%87.png",
      "2026/09/abc.png",
      "data/626d.png",
    ]);
  });

  it("目录不存在 → 空数组不抛", async () => {
    await expect(walkFiles(path.join(root, "no-such"))).resolves.toEqual([]);
  });
});

describe("diffInventory", () => {
  it("missing/extra/mismatch 三分类", () => {
    const d = diffInventory(
      new Map([
        ["a.png", 1],
        ["b.png", 2],
        ["c.png", 3],
      ]),
      new Map([
        ["b.png", 2],
        ["c.png", 9], // 字节数不符
        ["d.png", 4], // 仅桶有
      ]),
    );
    expect(d.missing).toEqual(["a.png"]);
    expect(d.mismatch).toEqual(["c.png"]);
    expect(d.extra).toEqual(["d.png"]);
  });

  it("双侧一致 → 全空", () => {
    const d = diffInventory(new Map([["a.png", 1]]), new Map([["a.png", 1]]));
    expect(d).toEqual({ missing: [], extra: [], mismatch: [] });
  });
});

describe("pickSamples", () => {
  it("n 超总量取全量;同 seed 可复现;覆盖范围打乱", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(pickSamples(items, 20)).toEqual(items);
    const a = pickSamples(items, 5, 7);
    const b = pickSamples(items, 5, 7);
    expect(a).toEqual(b);
    expect(a.length).toBe(5);
    for (const x of a) expect(items).toContain(x);
  });
});
