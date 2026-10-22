/**
 * 生成态纯函数单测(M44):post 完成=linkedPostId 出现或 updatedAt 推进、
 * pin 完成=pinIds 集合出现新 id(已 drafted 重生成 topic 行不动,必须比对
 * 集合)、未完成不误报、sessionStorage 往返与超时清除。
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearGeneration,
  detectCompletion,
  loadGeneration,
  saveGeneration,
  type GenerationBaseline,
  type StudioStateSnapshot,
} from "./generation-state";

const BASELINE: GenerationBaseline = {
  status: "collecting",
  updatedAt: "2026-10-22T10:00:00.000Z",
  linkedPostId: null,
  pinIds: ["1", "2"],
};

const snap = (over: Partial<StudioStateSnapshot>): StudioStateSnapshot => ({
  status: "collecting",
  updatedAt: BASELINE.updatedAt,
  linkedPostId: null,
  pinIds: ["1", "2"],
  ...over,
});

describe("detectCompletion post", () => {
  it("首稿落库:linkedPostId 出现即完成", () => {
    expect(
      detectCompletion(
        "post",
        BASELINE,
        snap({ linkedPostId: "42", updatedAt: "2026-10-22T10:01:00.000Z" }),
      ),
    ).toBe(true);
  });

  it("重生成:updatedAt 推进即完成(已有关联文档,不能要求 linkedPostId 从无到有)", () => {
    const baseline = { ...BASELINE, linkedPostId: "42" };
    expect(
      detectCompletion("post", baseline, snap({ updatedAt: "2026-10-22T10:05:00.000Z" })),
    ).toBe(true);
  });

  it("生成中无落库变化:不误报", () => {
    expect(detectCompletion("post", BASELINE, snap({}))).toBe(false);
  });
});

describe("detectCompletion pin", () => {
  it("新增贴图:集合出现新 id 即完成(已 drafted 重生成 topic 行不动的场景)", () => {
    expect(
      detectCompletion("pin", BASELINE, snap({ status: "drafted", pinIds: ["1", "2", "3"] })),
    ).toBe(true);
  });

  it("生成中集合不变:不误报", () => {
    expect(detectCompletion("pin", BASELINE, snap({}))).toBe(false);
  });

  it("重生成后集合与基线一致(覆盖同一批 id 的极端场景):不误报", () => {
    expect(detectCompletion("pin", BASELINE, snap({ status: "drafted" }))).toBe(false);
  });
});

describe("sessionStorage 持久化(node 环境以 stub 模拟,同 next-path.test)", () => {
  /** 最小 sessionStorage 桩(内存 Map;key/length 仅凑接口) */
  function stubSessionStorage(): Storage {
    const map = new Map<string, string>();
    return {
      setItem: (k: string, v: string) => void map.set(k, v),
      getItem: (k: string) => map.get(k) ?? null,
      removeItem: (k: string) => void map.delete(k),
      clear: () => void map.clear(),
      key: () => null,
      get length() {
        return map.size;
      },
    };
  }

  afterEach(() => {
    // @ts-expect-error 测试后拆桩,避免泄漏到其它用例
    delete globalThis.window;
  });

  it("save→load 往返无损,clear 后读空", () => {
    globalThis.window = { sessionStorage: stubSessionStorage() } as unknown as Window &
      typeof globalThis;
    saveGeneration("7", { kind: "pin", baseline: BASELINE, startedAt: Date.now() });
    expect(loadGeneration("7")).toEqual({
      kind: "pin",
      baseline: BASELINE,
      startedAt: expect.any(Number),
    });
    clearGeneration("7");
    expect(loadGeneration("7")).toBeNull();
  });

  it("损坏载荷:清除并返回 null", () => {
    const storage = stubSessionStorage();
    globalThis.window = { sessionStorage: storage } as unknown as Window & typeof globalThis;
    storage.setItem("studio-gen:7", "{not json");
    expect(loadGeneration("7")).toBeNull();
    expect(storage.getItem("studio-gen:7")).toBeNull();
  });

  it("超时载荷:清除并返回 null", () => {
    const storage = stubSessionStorage();
    globalThis.window = { sessionStorage: storage } as unknown as Window & typeof globalThis;
    saveGeneration("7", {
      kind: "post",
      baseline: BASELINE,
      startedAt: Date.now() - 481_000,
    });
    expect(loadGeneration("7")).toBeNull();
    expect(storage.getItem("studio-gen:7")).toBeNull();
  });

  it("无 window(SSR/异常环境)不抛错且读空", () => {
    expect(() =>
      saveGeneration("7", { kind: "pin", baseline: BASELINE, startedAt: 0 }),
    ).not.toThrow();
    expect(loadGeneration("7")).toBeNull();
    expect(() => clearGeneration("7")).not.toThrow();
  });
});
