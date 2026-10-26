/**
 * render_card 工具单测(M31 批B;2026-10-20 模板入口机制层关闭后重写):
 * admin 门 fail-closed / html 必填(schema 拒,含 legacy preset+data 形态回归锚)/
 * 占位回显拒渲 / 消毒报错直通 / 渲染+入库 happy path(服务 fetch 与 uploadMedia
 * 全 mock)/ width/maxHeight 透传。
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
import { RENDER_CARD_HTML_PLACEHOLDER } from "./context-trim";

type AnyTool = { invoke: (args: never, cfg?: never) => Promise<unknown> };

const ADMIN = { configurable: { thread_id: "t-admin" } } as never;

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
    async (_input: string | URL | Request, _init?: RequestInit) =>
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
    const r = await invoke(renderCardTool, { html: "<p>x</p>" });
    expect(r).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it("html 缺失 → schema 拒(2026-10-20 起 html 必填)", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    const fetchMock = stubFetch();
    await expect((renderCardTool as unknown as AnyTool).invoke({} as never, ADMIN)).rejects.toThrow(
      /html/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it("入口关闭回归锚:legacy preset+data 形态 → 同样因缺 html 被拒", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    const fetchMock = stubFetch();
    await expect(
      (renderCardTool as unknown as AnyTool).invoke(
        { preset: "stats", data: { items: [] } } as never,
        ADMIN,
      ),
    ).rejects.toThrow(/html/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("占位回显 → 拒渲染(上下文瘦身后的 args.html 被模型抄回来)", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    const fetchMock = stubFetch();
    const r = await invoke(renderCardTool, {
      html: `<div>${RENDER_CARD_HTML_PLACEHOLDER}</div>`,
    });
    expect(r).toMatchObject({ ok: false });
    expect(String(r.error)).toContain("系统为节省上下文做的压缩替换");
    expect(String(r.error)).toContain("不要重渲");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("消毒报错直通(不触达渲染)", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    const fetchMock = stubFetch();
    const r = await invoke(renderCardTool, { html: "<p onclick='x()'>a</p>" });
    expect(r).toMatchObject({ ok: false });
    expect(String(r.error)).toContain("消毒");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("happy path:渲染+入库,返回极小 JSON 与 accent", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    const fetchMock = stubFetch();
    uploadMedia.mockResolvedValueOnce({
      id: "10",
      path: "/wp-content/uploads/2026/10/free.png",
      reused: false,
      status: "ready",
    });
    const r = await invoke(renderCardTool, { html: '<div class="k"><h3>T</h3></div>' });
    expect(r).toMatchObject({
      ok: true,
      url: "/wp-content/uploads/2026/10/free.png",
      markdown_line: "![](/wp-content/uploads/2026/10/free.png)",
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
    const body = JSON.parse(String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body)) as {
      html: string;
      width: number;
      maxHeight?: number;
    };
    expect(body.html).toContain('class="k"');
    expect(body.width).toBe(900); // 默认宽
    expect(body.maxHeight).toBeUndefined(); // 不传不带(服务端默认 4000)
    expect(uploadMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        mime: "image/png",
        filename: expect.stringMatching(/^card-\d+\.png$/),
      }),
    );
  });

  it("width/maxHeight 透传渲染服务", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    const fetchMock = stubFetch();
    uploadMedia.mockResolvedValueOnce({
      id: "13",
      path: "/wp-content/uploads/2026/10/tall.png",
      reused: false,
      status: "ready",
    });
    await invoke(renderCardTool, { html: "<p>x</p>", width: 1080, maxHeight: 1440 });
    const body = JSON.parse(String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body)) as {
      width: number;
      maxHeight?: number;
    };
    expect(body.width).toBe(1080);
    expect(body.maxHeight).toBe(1440);
  });

  it("渲染服务不可达 → 短句报错", async () => {
    sessionFindUnique.mockResolvedValue({ visitorId: "admin:s" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const r = await invoke(renderCardTool, { html: "<p>x</p>" });
    expect(r).toMatchObject({ ok: false });
    expect(String(r.error)).toContain("不可达");
  });
});
