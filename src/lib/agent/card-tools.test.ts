/**
 * render_card 工具单测(M31 批B):admin 门 fail-closed / 双模路由与互斥校验 /
 * 消毒报错直通 / 渲染+入库 happy path(服务 fetch 与 uploadMedia 全 mock)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionFindUnique = vi.hoisted(() => vi.fn());
const uploadMedia = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({
  prisma: { searchAgentSession: { findUnique: sessionFindUnique } },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../media/service", () => ({ uploadMedia }));

import { renderCardTool } from "./card-tools";

type AnyTool = { invoke: (args: never, cfg?: never) => Promise<unknown> };

async function invoke(
  t: AnyTool,
  args: Record<string, unknown>,
  threadId = "t-admin",
): Promise<Record<string, unknown>> {
  const raw = (await t.invoke(
    args as never,
    { configurable: { thread_id: threadId } } as never,
  )) as string;
  return JSON.parse(raw) as Record<string, unknown>;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function stubFetch(status = 200) {
  const fetchMock = vi.fn(
    async () =>
      new Response(PNG as unknown as BodyInit, {
        status,
        headers: { "content-type": "image/png", "x-card-width": "900", "x-card-height": "420" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("render_card", () => {
  it("非 admin 会话 → 拒且不触达渲染/入库", async () => {
    sessionFindUnique.mockResolvedValueOnce({ visitorId: "user:u1" });
    const fetchMock = stubFetch();
    const r = await invoke(renderCardTool, { preset: "quote", data: { quote: "x" } });
    expect(r).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it("preset 与 html 互斥 / 双缺 / preset 缺 data → 人话报错", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    expect(
      await invoke(renderCardTool, { preset: "quote", data: { quote: "x" }, html: "<p>y</p>" }),
    ).toMatchObject({ ok: false });
    expect(await invoke(renderCardTool, {})).toMatchObject({ ok: false });
    expect(await invoke(renderCardTool, { preset: "quote" })).toMatchObject({ ok: false });
  });

  it("preset 模式 happy path:渲染+入库,返回极小 JSON", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    const fetchMock = stubFetch();
    uploadMedia.mockResolvedValueOnce({
      id: "9",
      path: "/wp-content/uploads/2026/10/card.png",
      reused: false,
      status: "ready",
    });
    const r = await invoke(renderCardTool, {
      preset: "stats",
      data: {
        items: [
          { value: "1", label: "a" },
          { value: "2", label: "b" },
        ],
      },
    });
    expect(r).toMatchObject({
      ok: true,
      url: "/wp-content/uploads/2026/10/card.png",
      markdown_line: "![](/wp-content/uploads/2026/10/card.png)",
      width: 900,
      height: 420,
    });
    expect(r.accent).toMatchObject({
      main: expect.stringMatching(/^#[0-9a-f]{6}$/),
      soft: expect.any(String),
      text: expect.any(String),
    });
    expect(String(r.hint)).toContain("card_urls");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(uploadMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        mime: "image/png",
        filename: expect.stringContaining("card-stats-"),
      }),
    );
  });

  it("漂移收编:rows 包成 {item:{item:[…]}} → 归一后照常渲染入库", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    stubFetch();
    uploadMedia.mockResolvedValueOnce({
      id: "11",
      path: "/wp-content/uploads/2026/10/n.png",
      reused: false,
      status: "ready",
    });
    const r = await invoke(renderCardTool, {
      preset: "ledger",
      data: {
        rows: {
          item: {
            item: [
              { k: "上下文", v: "200k" },
              { k: "模态", v: "文本" },
              { k: "开源", v: "是" },
            ],
          },
        },
      },
    });
    expect(r).toMatchObject({ ok: true, url: "/wp-content/uploads/2026/10/n.png" });
  });

  it("漂移收编:rows 字符串化 JSON/双重嵌套 → 归一后照常渲染入库", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    stubFetch();
    uploadMedia.mockResolvedValue({
      id: "12",
      path: "/wp-content/uploads/2026/10/s.png",
      reused: false,
      status: "ready",
    });
    const rows = [
      { k: "上下文", v: "200k" },
      { k: "模态", v: "文本" },
      { k: "开源", v: "是" },
    ];
    // 字符串化双重嵌套(checkpoint 取证的「自纠越修越歪」形态)
    const r1 = await invoke(renderCardTool, {
      preset: "ledger",
      data: { rows: JSON.stringify([rows]) },
    });
    // 二元数组行
    const r2 = await invoke(renderCardTool, {
      preset: "ledger",
      data: {
        rows: [
          ["上下文", "200k"],
          ["模态", "文本"],
          ["开源", "是"],
        ],
      },
    });
    expect(r1).toMatchObject({ ok: true, url: "/wp-content/uploads/2026/10/s.png" });
    expect(r2).toMatchObject({ ok: true, url: "/wp-content/uploads/2026/10/s.png" });
  });

  it("preset 数据仍不合法 → 人话报错 + 无效数据落日志", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    const { logger } = await import("../logger");
    // 收编层不认识的形态(单键非 item 对象)透传 zod 后仍失败
    const r = await invoke(renderCardTool, {
      preset: "ledger",
      data: { rows: { key: [{ k: "a", v: "b" }] } },
    });
    expect(r).toMatchObject({ ok: false });
    expect(String(r.error)).toContain("rows 应为数组,收到了对象");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agent.card_preset_invalid", preset: "ledger" }),
    );
  });

  it("自由 HTML 模式:消毒报错直通(不触达渲染)", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    const fetchMock = stubFetch();
    const r = await invoke(renderCardTool, { html: "<p onclick='x()'>a</p>" });
    expect(r).toMatchObject({ ok: false });
    expect(String(r.error)).toContain("消毒");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("自由 HTML 模式 happy path", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    stubFetch();
    uploadMedia.mockResolvedValueOnce({
      id: "10",
      path: "/wp-content/uploads/2026/10/free.png",
      reused: false,
      status: "ready",
    });
    const r = await invoke(renderCardTool, { html: '<div class="k"><h3>T</h3></div>' });
    expect(r).toMatchObject({ ok: true, url: "/wp-content/uploads/2026/10/free.png" });
  });

  it("渲染服务不可达 → 短句报错", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const r = await invoke(renderCardTool, { preset: "quote", data: { quote: "x" } });
    expect(r).toMatchObject({ ok: false });
    expect(String(r.error)).toContain("不可达");
  });
});
