/**
 * 渲染客户端单测(M31 批B 建;COS 引图补丁改内联口径):POST 组装用内联产物、
 * 内联报错原样传导(不被不可达兜底吞掉)、状态码人话映射。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const inlineSiteMediaRefs = vi.hoisted(() => vi.fn());
vi.mock("./media-inline", () => ({ inlineSiteMediaRefs }));

import { renderCardPng } from "./render";

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

describe("renderCardPng", () => {
  it("POST 体使用内联后的 HTML(站内图已是 data URI,不再 file:// 改写)", async () => {
    const inlined = '<img src="data:image/png;base64,QUJD">';
    inlineSiteMediaRefs.mockResolvedValueOnce(inlined);
    const fetchMock = stubFetch();
    const card = await renderCardPng('<img src="/wp-content/uploads/a.png">', { width: 900 });
    expect(inlineSiteMediaRefs).toHaveBeenCalledWith('<img src="/wp-content/uploads/a.png">');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/render");
    expect(JSON.parse(String(init.body))).toEqual({ html: inlined, width: 900, scale: 2 });
    expect(card).toMatchObject({ width: 900, height: 420 });
    expect(card.png).toEqual(PNG);
  });

  it("maxHeight 显式传入才进 body;省略时不出现(服务端按默认 4000)", async () => {
    inlineSiteMediaRefs.mockResolvedValue("<p>x</p>");
    const fetchMock = stubFetch();
    await renderCardPng("<p>x</p>", { width: 1080, maxHeight: 6000 });
    const [, first] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(first.body))).toEqual({
      html: "<p>x</p>",
      width: 1080,
      scale: 2,
      maxHeight: 6000,
    });
    await renderCardPng("<p>x</p>");
    const [, second] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect("maxHeight" in JSON.parse(String(second.body))).toBe(false);
  });

  it("内联报错(文件缺失等)原样传导,不被服务不可达兜底吞掉", async () => {
    inlineSiteMediaRefs.mockRejectedValueOnce(
      new Error("站内图片文件缺失:/wp-content/uploads/g.png"),
    );
    const fetchMock = stubFetch();
    await expect(renderCardPng('<img src="/wp-content/uploads/g.png">')).rejects.toThrow(
      "站内图片文件缺失:/wp-content/uploads/g.png",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429 → 人话「渲染服务忙」", async () => {
    inlineSiteMediaRefs.mockResolvedValueOnce("<p>x</p>");
    stubFetch(429);
    await expect(renderCardPng("<p>x</p>")).rejects.toThrow("渲染服务忙(并发已满),请稍后重试");
  });
});
