/**
 * 小红书登录态探照单测(M50 批F):取数容错三态(gateway 200/异常/形状漂移)
 * 与 kv 落账形状。三态语义红线:loggedIn null=探照不可达,≠Cookie 过期。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: { siteConfig: { upsert: vi.fn(), findUnique: vi.fn() } },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from "../db";
import { fetchXhsState, getXhsLastProbe, runXhsStateProbe } from "./xhs-probe";

const mockedUpsert = vi.mocked(prisma.siteConfig.upsert);
const mockedFind = vi.mocked(prisma.siteConfig.findUnique);

function mockFetch(json: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => json }) as unknown as Response),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchXhsState 三态", () => {
  it("gateway 200 → 结构化投影(snake→内形)", async () => {
    mockFetch({ storage_state_ready: true, logged_in: true, landmarks: { creator_tab: 4 } });
    const snap = await fetchXhsState();
    expect(snap).toEqual({ storage_state_ready: true, logged_in: true });
  });

  it("gateway 不可达 → loggedIn null(不可达 ≠ Cookie 过期)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    const snap = await fetchXhsState();
    expect(snap).toEqual({
      storage_state_ready: false,
      logged_in: null,
      error: "connect ECONNREFUSED",
    });
  });

  it("形状漂移(非布尔 logged_in)→ null 不误判", async () => {
    mockFetch({ storage_state_ready: false, logged_in: "yes" });
    const snap = await fetchXhsState();
    expect(snap.logged_in).toBeNull();
  });
});

describe("runXhsStateProbe / getXhsLastProbe", () => {
  it("取数落 kv(upsert 形状带 ISO checkedAt);读侧 Zod 放行", async () => {
    mockFetch({ storage_state_ready: true, logged_in: false });
    const rec = await runXhsStateProbe();
    expect(rec.loggedIn).toBe(false);
    expect(mockedUpsert).toHaveBeenCalledTimes(1);
    const args = mockedUpsert.mock.calls[0][0];
    expect(args.where).toEqual({ key: "distribute.xhs_state" });
    const written = JSON.parse(args.update.value as string) as { checkedAt: string };
    expect(new Date(written.checkedAt).toString()).not.toBe("Invalid Date");

    mockedFind.mockResolvedValue({ value: args.update.value } as never);
    expect(await getXhsLastProbe()).toMatchObject({ loggedIn: false, storageReady: true });
  });

  it("读侧:无记录 → null;坏 JSON → null(不抛)", async () => {
    mockedFind.mockResolvedValue(null as never);
    expect(await getXhsLastProbe()).toBeNull();
    mockedFind.mockResolvedValue({ value: "not-json" } as never);
    expect(await getXhsLastProbe()).toBeNull();
  });
});
