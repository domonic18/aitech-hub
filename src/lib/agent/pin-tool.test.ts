/**
 * save_topic_pin 单测(M42 批③,全 mock):admin 会话防线 / 阅读原文缺省取本创作
 * 长文(软删/缺行不设,显式传则覆盖)/ 回执带组装台与前台链接 / 落库硬闸错误
 * 人话化(PinError → ok:false,不抛)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAdminThread = vi.hoisted(() => vi.fn());
vi.mock("./admin-thread", () => ({
  assertAdminThread,
  adminThreadDeny: vi.fn(() => JSON.stringify({ ok: false, error: "非 topic 会话" })),
}));

const getTopic = vi.hoisted(() => vi.fn());
vi.mock("../topics/repo", () => ({
  getTopic,
  TopicError: class extends Error {
    constructor(_code: string, message: string) {
      super(message);
    }
  },
}));

const createPinWithImages = vi.hoisted(() => vi.fn());
vi.mock("../pins/assemble", () => ({ createPinWithImages }));

const db = vi.hoisted(() => ({
  postFindUnique: vi.fn(),
  pinCount: vi.fn(),
}));
vi.mock("../db", () => ({
  prisma: {
    post: { findUnique: db.postFindUnique },
    contentPin: { count: db.pinCount },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { PinError } from "../pins/repo";
import { saveTopicPinTool } from "./pin-tool";

const PIN = {
  id: BigInt(77),
  title: "端侧推理的三件事",
  status: "draft",
};

const IMG = "/wp-content/uploads/2026/10/gen-1.png";

async function invoke(args: Record<string, unknown>, threadId = "t-admin") {
  const raw = (await saveTopicPinTool.invoke(
    args as never,
    { configurable: { thread_id: threadId } } as never,
  )) as string;
  return JSON.parse(raw) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  assertAdminThread.mockResolvedValue(true);
  getTopic.mockResolvedValue({ id: BigInt(7), linkedPostId: BigInt(42) });
  createPinWithImages.mockResolvedValue(PIN);
  db.postFindUnique.mockResolvedValue({ id: BigInt(42), slug: "on-device", status: "published" });
  db.pinCount.mockResolvedValue(2);
});

describe("save_topic_pin", () => {
  it("非 admin 会话 → deny 且不触达业务", async () => {
    assertAdminThread.mockResolvedValueOnce(false);
    const out = await invoke({ topic_id: "7", title: "t", image_paths: [IMG] });
    expect(out.ok).toBe(false);
    expect(createPinWithImages).not.toHaveBeenCalled();
  });

  it("阅读原文缺省取本创作长文;回执带组装台/前台链接与贴图数", async () => {
    const out = await invoke({
      topic_id: "7",
      title: PIN.title,
      content: "轻文字",
      image_paths: [IMG],
      reference_path: "/wp-content/uploads/2026/10/sample.png",
      crop_spec: "16_9",
    });
    expect(createPinWithImages).toHaveBeenCalledWith({
      title: PIN.title,
      content: "轻文字",
      topicId: BigInt(7),
      images: [IMG],
      referenceMediaPath: "/wp-content/uploads/2026/10/sample.png",
      cropSpec: "16_9",
      readMoreUrl: "http://localhost:3000/post/42-on-device/",
    });
    expect(out).toMatchObject({
      ok: true,
      pin_id: "77",
      images: 1,
      read_more_source: "linked_post",
      topic_pin_count: 2,
      admin_url: "/admin/pins/77",
      // 纯中文标题无 ASCII slug → canonical 退化为 /pins/<id>/(id 锚定)
      preview_url: "http://localhost:3000/pins/77/",
    });
  });

  it("显式阅读原文覆盖缺省,不再查长文", async () => {
    const out = await invoke({
      topic_id: "7",
      title: "t",
      image_paths: [IMG],
      read_more_url: "https://example.com/a",
    });
    expect(db.postFindUnique).not.toHaveBeenCalled();
    expect(createPinWithImages).toHaveBeenCalledWith(
      expect.objectContaining({ readMoreUrl: "https://example.com/a" }),
    );
    expect(out.read_more_source).toBe("manual");
  });

  it("长文缺失/软删或创作无长文 → 不设阅读原文", async () => {
    db.postFindUnique.mockResolvedValueOnce({ id: BigInt(42), slug: "x", status: "deleted" });
    await invoke({ topic_id: "7", title: "t", image_paths: [IMG] });
    expect(createPinWithImages).toHaveBeenLastCalledWith(
      expect.objectContaining({ readMoreUrl: null }),
    );
    getTopic.mockResolvedValueOnce({ id: BigInt(7), linkedPostId: null });
    await invoke({ topic_id: "7", title: "t", image_paths: [IMG] });
    expect(createPinWithImages).toHaveBeenLastCalledWith(
      expect.objectContaining({ readMoreUrl: null }),
    );
  });

  it("落库硬闸失败(PinError)→ ok:false 人话,不抛", async () => {
    createPinWithImages.mockRejectedValueOnce(new PinError("invalid_input", "图片路径有重复"));
    const out = await invoke({ topic_id: "7", title: "t", image_paths: [IMG] });
    expect(out).toEqual({ ok: false, error: "图片路径有重复" });
  });
});
