/**
 * tools 单测(prisma/unified-search 必 mock):工具面构成(名字收口;K2.6 四
 * 只读工具 + M22 批⑤ submit_feedback 唯一可写口)+ get_time 输出形状
 * (iso/beijing/timezone,北京时区显式锚定不随机器漂)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  post: { findFirst: vi.fn() },
  githubRepo: { findFirst: vi.fn() },
}));
const searchAllMock = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("../search/unified-search", () => ({ searchAll: searchAllMock }));

import { AGENT_TOOLS, getTimeTool } from "./tools";

beforeEach(() => {
  prismaMock.post.findFirst.mockReset();
  prismaMock.githubRepo.findFirst.mockReset();
  searchAllMock.mockReset();
});

describe("AGENT_TOOLS", () => {
  it("工具面收口为五只(四只读 + submit_feedback 唯一可写),名字与顺序固定", () => {
    expect(AGENT_TOOLS).toHaveLength(5);
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual([
      "search_site",
      "read_post",
      "read_repo",
      "get_time",
      "submit_feedback",
    ]);
  });
});

describe("getTimeTool", () => {
  it("返回 iso/beijing/timezone,beijing 为北京时区 YYYY/MM/DD HH:mm", async () => {
    const out = JSON.parse(await getTimeTool.invoke({}));
    expect(out.timezone).toBe("Asia/Shanghai");
    expect(new Date(out.iso).toISOString()).toBe(out.iso);
    // zh-CN 2-digit 组合固定为 2026/10/07 14:33 形态;时区显式指定,不随机器 TZ 漂移
    expect(out.beijing).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    // beijing 与 iso 同源:同一时刻的北京钟面(用 iso 反推校验日期一致性)
    const fromIso = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(out.iso));
    expect(out.beijing).toBe(fromIso);
  });
});
