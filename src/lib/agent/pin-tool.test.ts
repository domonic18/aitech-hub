/**
 * save_topic_pin / update_topic_pin 单测(M42 批③建,M46 验收批扩,全 mock):
 * admin 会话防线 / 阅读原文缺省由执行面回填本贴自链(显式传则覆盖)/ 回执带
 * 组装台与前台链接 / 落库硬闸错误人话化(PinError → ok:false,不抛)/
 * update_topic_pin 归属校验与同步态提示。
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

const updatePin = vi.hoisted(() => vi.fn());
vi.mock("../pins/repo", () => ({
  PinError: class extends Error {
    constructor(_code: string, message: string) {
      super(message);
    }
  },
  updatePin,
}));

const db = vi.hoisted(() => ({
  pinCount: vi.fn(),
  pinFindUnique: vi.fn(),
  channelCount: vi.fn(),
}));
vi.mock("../db", () => ({
  prisma: {
    contentPin: { count: db.pinCount, findUnique: db.pinFindUnique },
    contentPinChannel: { count: db.channelCount },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { PinError } from "../pins/repo";
import { saveTopicPinTool, updateTopicPinTool } from "./pin-tool";

const PIN = {
  id: BigInt(77),
  title: "端侧推理的三件事",
  status: "draft",
  readMoreUrl: "http://localhost:3000/pins/77/",
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
  db.pinCount.mockResolvedValue(2);
  db.pinFindUnique.mockResolvedValue({
    id: BigInt(77),
    title: PIN.title,
    topicId: BigInt(7),
    status: "draft",
  });
  updatePin.mockResolvedValue({
    id: BigInt(77),
    title: "新标题",
    status: "draft",
  });
  db.channelCount.mockResolvedValue(0);
});

describe("save_topic_pin", () => {
  it("非 admin 会话 → deny 且不触达业务", async () => {
    assertAdminThread.mockResolvedValueOnce(false);
    const out = await invoke({ topic_id: "7", title: "t", image_paths: [IMG] });
    expect(out.ok).toBe(false);
    expect(createPinWithImages).not.toHaveBeenCalled();
  });

  it("阅读原文缺省由执行面回填本贴自链;回执带组装台/前台链接与贴图数", async () => {
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
      readMoreUrl: null,
    });
    expect(out).toMatchObject({
      ok: true,
      pin_id: "77",
      images: 1,
      read_more_url: "http://localhost:3000/pins/77/",
      read_more_source: "self",
      topic_pin_count: 2,
      admin_url: "/admin/pins/77",
      // 纯中文标题无 ASCII slug → canonical 退化为 /pins/<id>/(id 锚定)
      preview_url: "http://localhost:3000/pins/77/",
    });
  });

  it("显式阅读原文覆盖缺省自链", async () => {
    const out = await invoke({
      topic_id: "7",
      title: "t",
      image_paths: [IMG],
      read_more_url: "https://example.com/a",
    });
    expect(createPinWithImages).toHaveBeenCalledWith(
      expect.objectContaining({ readMoreUrl: "https://example.com/a" }),
    );
    expect(out.read_more_source).toBe("manual");
  });

  it("落库硬闸失败(PinError)→ ok:false 人话,不抛", async () => {
    createPinWithImages.mockRejectedValueOnce(new PinError("invalid_input", "图片路径有重复"));
    const out = await invoke({ topic_id: "7", title: "t", image_paths: [IMG] });
    expect(out).toEqual({ ok: false, error: "图片路径有重复" });
  });
});

describe("update_topic_pin", () => {
  async function invokeUpdate(args: Record<string, unknown>, threadId = "t-admin") {
    const raw = (await updateTopicPinTool.invoke(
      args as never,
      { configurable: { thread_id: threadId } } as never,
    )) as string;
    return JSON.parse(raw) as Record<string, unknown>;
  }

  it("非 admin 会话 → deny 且不触达业务", async () => {
    assertAdminThread.mockResolvedValueOnce(false);
    const out = await invokeUpdate({ pin_id: "77", topic_id: "7", content: "x" });
    expect(out.ok).toBe(false);
    expect(updatePin).not.toHaveBeenCalled();
  });

  it("归属校验过 → 改轻文字与阅读原文;回执带链接,无同步提示", async () => {
    const out = await invokeUpdate({
      pin_id: "77",
      topic_id: "7",
      content: "补一段视频介绍 https://example.com/v/1",
      read_more_url: "https://example.com/v/1",
    });
    expect(updatePin).toHaveBeenCalledWith(BigInt(77), {
      content: "补一段视频介绍 https://example.com/v/1",
      readMoreUrl: "https://example.com/v/1",
    });
    expect(out).toMatchObject({
      ok: true,
      pin_id: "77",
      status: "draft",
      wechat_resync_needed: false,
      admin_url: "/admin/pins/77",
    });
    expect(String(out.message)).not.toContain("重新同步");
  });

  it("已同步公众号 → 回执 wechat_resync_needed:true 提示组装台重新同步", async () => {
    db.channelCount.mockResolvedValueOnce(1);
    updatePin.mockResolvedValueOnce({ id: BigInt(77), title: "t", status: "synced" });
    const out = await invokeUpdate({ pin_id: "77", topic_id: "7", title: "t" });
    expect(out.wechat_resync_needed).toBe(true);
    expect(String(out.message)).toContain("组装台重新同步");
  });

  it("贴图不属于本创作或不存在 → ok:false 人话,不触 repo", async () => {
    db.pinFindUnique.mockResolvedValueOnce({
      id: BigInt(77),
      topicId: BigInt(9),
      status: "draft",
    });
    const out = await invokeUpdate({ pin_id: "77", topic_id: "7", content: "x" });
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("不属于本创作");
    expect(updatePin).not.toHaveBeenCalled();
    db.pinFindUnique.mockResolvedValueOnce(null);
    const out2 = await invokeUpdate({ pin_id: "99", topic_id: "7", content: "x" });
    expect(out2.ok).toBe(false);
  });

  it("已同步/已发布直编被 repo 拒(edit_locked)→ 人话回传", async () => {
    updatePin.mockRejectedValueOnce(
      new PinError("edit_locked", "已同步/已发布贴图不可直接编辑,请先撤回待验收"),
    );
    const out = await invokeUpdate({ pin_id: "77", topic_id: "7", content: "x" });
    expect(out).toEqual({ ok: false, error: "已同步/已发布贴图不可直接编辑,请先撤回待验收" });
  });

  it("码点硬闸(schema 单源):标题超 32 码字 → ok:false,不触 repo", async () => {
    const out = await invokeUpdate({
      pin_id: "77",
      topic_id: "7",
      title: "超".repeat(33),
    });
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("标题最长");
    expect(updatePin).not.toHaveBeenCalled();
  });
});
