/**
 * 电报流公开端点缓存单测:band=1 首屏形态 45s 短缓存 + in-flight 去重。
 * 覆盖:重复请求只查一次库 / 不同 limit 各查 / 非 band 形态不进缓存 /
 * TTL 过期后重查 / 并发同键合并为一次查询。缓存为模块级,每例 resetModules 隔离。
 */
import { NextRequest, type NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listBandFeed, countTodayVisible, listPublicTelegram } = vi.hoisted(() => ({
  listBandFeed: vi.fn(),
  countTodayVisible: vi.fn(),
  listPublicTelegram: vi.fn(),
}));

vi.mock("@/lib/telegram/public-feed", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/telegram/public-feed")>();
  return { ...orig, listBandFeed, countTodayVisible, listPublicTelegram };
});

const BAND_URL = "http://localhost/api/telegram/public/?band=1&limit=12";

function req(url: string): NextRequest {
  return new NextRequest(url);
}

async function loadGET(): Promise<(r: NextRequest) => Promise<NextResponse>> {
  vi.resetModules();
  const mod = await import("./route");
  return mod.GET as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.mocked(listBandFeed).mockResolvedValue({ items: [], nextOffset: 12 } as never);
  vi.mocked(countTodayVisible).mockResolvedValue(42);
  vi.mocked(listPublicTelegram).mockResolvedValue([] as never);
});

describe("GET /api/telegram/public(band=1 首屏短缓存)", () => {
  it("同参数连打三次:源查询只发生一次,响应一致", async () => {
    const GET = await loadGET();
    const a = await GET(req(BAND_URL));
    const b = await GET(req(BAND_URL));
    const c = await GET(req(BAND_URL));
    expect(listBandFeed).toHaveBeenCalledTimes(1);
    expect(countTodayVisible).toHaveBeenCalledTimes(1);
    expect(a.status).toBe(200);
    const [bodyA, bodyB, bodyC] = await Promise.all([a.json(), b.json(), c.json()]);
    expect(bodyA).toEqual(bodyB);
    expect(bodyA).toEqual(bodyC);
  });

  it("浏览器侧仍 no-store(轮询语义不变)", async () => {
    const GET = await loadGET();
    const res = await GET(req(BAND_URL));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("不同 limit 各查一次(键按 limit 分)", async () => {
    const GET = await loadGET();
    await GET(req(BAND_URL));
    await GET(req("http://localhost/api/telegram/public/?band=1&limit=50"));
    expect(listBandFeed).toHaveBeenCalledTimes(2);
  });

  it("非 band 形态不进缓存(翻页/筛选直查)", async () => {
    const GET = await loadGET();
    await GET(req("http://localhost/api/telegram/public/?limit=12"));
    await GET(req("http://localhost/api/telegram/public/?limit=12"));
    expect(listPublicTelegram).toHaveBeenCalledTimes(2);
    expect(listBandFeed).not.toHaveBeenCalled();
  });

  it("band=1 但 offset>0 的后续页不进缓存", async () => {
    const GET = await loadGET();
    await GET(req("http://localhost/api/telegram/public/?band=1&offset=12"));
    await GET(req("http://localhost/api/telegram/public/?band=1&offset=12"));
    expect(listPublicTelegram).toHaveBeenCalledTimes(2);
    expect(listBandFeed).not.toHaveBeenCalled();
  });

  it("TTL 过期后重新查库", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T00:00:00Z"));
    const GET = await loadGET();
    await GET(req(BAND_URL));
    vi.setSystemTime(new Date("2026-11-25T00:00:46Z")); // 45s TTL 已过
    await GET(req(BAND_URL));
    expect(listBandFeed).toHaveBeenCalledTimes(2);
  });

  it("并发同键合并为一次查询(in-flight 去重)", async () => {
    const GET = await loadGET();
    let resolveBand: (v: unknown) => void = () => {};
    vi.mocked(listBandFeed).mockReturnValue(
      new Promise((resolve) => {
        resolveBand = resolve;
      }) as never,
    );
    const p1 = GET(req(BAND_URL));
    const p2 = GET(req(BAND_URL));
    resolveBand({ items: [], nextOffset: 7 });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(listBandFeed).toHaveBeenCalledTimes(1);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });
});
