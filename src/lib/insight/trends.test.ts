/** 趋势读侧单测(M34 批③ 可视化增强):缺日/缺源/缺桶补 0,北京日键序(prisma mock)。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  // 懒包装:工厂随被 mock 模块首查执行,先于本文件顶层 const,急切引用会 TDZ
  prisma: {
    $queryRaw: (_strings: TemplateStringsArray, ..._values: unknown[]) => queryMock(),
  },
}));

import { insightHourHeat, insightTrendDaily } from "./trends";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("insightTrendDaily", () => {
  it("缺日/缺源补 0,序列旧→新含今日,源按白名单序", async () => {
    // 只回两桶:知乎 10-16 3 条、B站 10-18(今日)2 条,其余应补 0
    queryMock.mockResolvedValue([
      { d: "2026-10-16", source: "hot-zhihu", c: BigInt(3) },
      { d: "2026-10-18", source: "hot-bilibili", c: BigInt(2) },
    ]);
    const days = await insightTrendDaily(new Date("2026-10-18T08:00:00+08:00"));
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe("2026-10-18");
    expect(days[0].date).toBe("2026-10-12");
    // 白名单序:internal-comment, telegram-ai, hot-baidu, hot-zhihu, hot-bilibili
    expect(days[4].bySource).toEqual({
      "internal-comment": 0,
      "telegram-ai": 0,
      "hot-baidu": 0,
      "hot-zhihu": 3,
      "hot-bilibili": 0,
    });
    expect(days[6].bySource["hot-bilibili"]).toBe(2);
    expect(days[6].bySource["hot-zhihu"]).toBe(0);
  });
});

describe("insightHourHeat", () => {
  it("输出周一→周日 168 格,缺桶补 0", async () => {
    queryMock.mockResolvedValue([
      { dow: 0, hour: 20, c: BigInt(9) }, // 周日 20 时
      { dow: 6, hour: 1, c: BigInt(4) }, // 周六 1 时
    ]);
    const cells = await insightHourHeat(new Date("2026-10-18T08:00:00+08:00"));
    expect(cells).toHaveLength(7 * 24);
    expect(cells[0]).toEqual({ dow: 1, hour: 0, count: 0 }); // 首格=周一 0 时
    const sun20 = cells.find((c) => c.dow === 0 && c.hour === 20);
    const sat1 = cells.find((c) => c.dow === 6 && c.hour === 1);
    expect(sun20?.count).toBe(9);
    expect(sat1?.count).toBe(4);
    expect(cells.filter((c) => c.count > 0)).toHaveLength(2);
  });
});
