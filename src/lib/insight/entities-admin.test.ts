/** 实体聚合视图单测(prisma mock,无真库):筛选钳制/关键词清洗/key 形态/
 * 列表分组与最近事件补齐/详情空态。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const entityGroupBy = vi.fn();
const entityFindMany = vi.fn();
const entityCount = vi.fn();
const rawQuery = vi.fn();
const signalFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    entityEvent: {
      groupBy: (...a: unknown[]) => entityGroupBy(...a),
      findMany: (...a: unknown[]) => entityFindMany(...a),
      count: (...a: unknown[]) => entityCount(...a),
    },
    insightSignal: {
      findMany: (...a: unknown[]) => signalFindMany(...a),
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) =>
      rawQuery(strings, ...values),
  },
}));

import {
  ENTITIES_PATH,
  buildEntityWhere,
  entityHref,
  entityListHref,
  getEntityDetail,
  isCanonicalEntityKey,
  listEntities,
  resolveEntityFilters,
  sanitizeEntityQuery,
} from "./entities-admin";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveEntityFilters", () => {
  it("白名单内保留,白名单外丢弃;window 只认 7/30/90", () => {
    expect(
      resolveEntityFilters({
        vendor: "openai",
        entityType: "model",
        window: "30",
        q: "  deepseek ",
        page: "2",
      }),
    ).toEqual({
      vendor: "openai",
      entityType: "model",
      windowDays: 30,
      q: "deepseek",
      page: 2,
    });
    expect(
      resolveEntityFilters({ vendor: "nope", entityType: "paper", window: "15", page: "x" }),
    ).toEqual({
      vendor: undefined,
      entityType: undefined,
      windowDays: undefined,
      q: undefined,
      page: 1,
    });
  });
});

describe("sanitizeEntityQuery", () => {
  it("trim / 截断 40 / 去 ILIKE 元字符 / 空串不筛", () => {
    expect(sanitizeEntityQuery("  gpt-5  ")).toBe("gpt-5");
    expect(sanitizeEntityQuery("a".repeat(60))).toBe("a".repeat(40));
    expect(sanitizeEntityQuery("100%_x\\y")).toBe("100xy");
    expect(sanitizeEntityQuery("   ")).toBeUndefined();
    expect(sanitizeEntityQuery(undefined)).toBeUndefined();
  });
});

describe("isCanonicalEntityKey", () => {
  it("接受 normalizeEntityKey 不动点(含中文与 /)", () => {
    expect(isCanonicalEntityKey("deepseek-v4")).toBe(true);
    expect(isCanonicalEntityKey("qwen2.5-vl")).toBe(true);
    expect(isCanonicalEntityKey("meta-llama/llama-4")).toBe(true);
    expect(isCanonicalEntityKey("文心一言")).toBe(true);
  });

  it("拒绝大写/空格/保留字符/点段/超长/空串", () => {
    expect(isCanonicalEntityKey("DeepSeek-V4")).toBe(false);
    expect(isCanonicalEntityKey("deep seek")).toBe(false);
    expect(isCanonicalEntityKey("a?b")).toBe(false);
    expect(isCanonicalEntityKey("../etc")).toBe(false);
    expect(isCanonicalEntityKey("a/../b")).toBe(false);
    expect(isCanonicalEntityKey("a//b")).toBe(false);
    expect(isCanonicalEntityKey("")).toBe(false);
    expect(isCanonicalEntityKey("a".repeat(121))).toBe(false);
  });
});

describe("URL 构造", () => {
  it("entityHref 按段编码,保住 / 分隔", () => {
    expect(entityHref("deepseek-v4")).toBe("/admin/insight/entities/deepseek-v4/");
    expect(entityHref("meta-llama/llama-4")).toBe("/admin/insight/entities/meta-llama/llama-4/");
  });

  it("entityHref 末段含 . 时不出尾斜杠(Next 视作文件路径,带斜杠会 308)", () => {
    expect(entityHref("kimi-k2.6")).toBe("/admin/insight/entities/kimi-k2.6");
    expect(entityHref("owner/repo.v2")).toBe("/admin/insight/entities/owner/repo.v2");
    // 点只在中段时末段仍按目录处理
    expect(entityHref("a.b/c")).toBe("/admin/insight/entities/a.b/c/");
  });

  it("entityListHref 空值不落串,page>1 才携带", () => {
    expect(entityListHref({ page: 1 })).toBe(ENTITIES_PATH);
    expect(
      entityListHref(
        { vendor: "qwen", entityType: "model", windowDays: 7, q: "qwen3", page: 3 },
        { page: 1 },
      ),
    ).toBe("/admin/insight/entities/?vendor=qwen&entityType=model&window=7&q=qwen3");
  });
});

describe("buildEntityWhere", () => {
  it("时间窗按北京日界折算(近 7 天=今日+前 6 日零点起)", () => {
    const now = new Date("2026-10-30T05:00:00Z"); // 北京 10-30 13:00
    expect(buildEntityWhere({ windowDays: 7, page: 1 }, now)).toEqual({
      occurredAt: { gte: new Date("2026-10-23T16:00:00Z") },
    });
    expect(buildEntityWhere({ page: 1 }, now)).toEqual({});
  });

  it("vendor/type 精确、q 走 insensitive contains", () => {
    expect(buildEntityWhere({ vendor: "qwen", entityType: "model", q: "qwen3", page: 1 })).toEqual({
      vendor: "qwen",
      entityType: "model",
      entityKey: { contains: "qwen3", mode: "insensitive" },
    });
  });
});

describe("listEntities", () => {
  it("本页分组 + 最近事件补齐(同键只取首条)+ count(DISTINCT) 总数", async () => {
    const lastA = new Date("2026-10-29T02:00:00Z");
    entityGroupBy.mockResolvedValue([
      { entityKey: "deepseek-v4", _count: { _all: 2 }, _max: { occurredAt: lastA } },
      {
        entityKey: "claude-opus-5-5",
        _count: { _all: 1 },
        _max: { occurredAt: new Date("2026-10-28T02:00:00Z") },
      },
    ]);
    rawQuery.mockResolvedValue([{ count: BigInt(40) }]);
    entityFindMany.mockResolvedValue([
      {
        entityKey: "deepseek-v4",
        vendor: "deepseek",
        entityType: "model",
        eventType: "release",
        title: "DeepSeek V4 发布",
        url: "https://api-docs.deepseek.com/news/v4",
      },
      {
        entityKey: "deepseek-v4",
        vendor: "deepseek",
        entityType: "model",
        eventType: "price_change",
        title: "旧事件",
        url: "https://api-docs.deepseek.com/news/old",
      },
    ]);
    const data = await listEntities({ entityType: "model", page: 2 });
    expect(data.total).toBe(40);
    expect(data.pages).toBe(1);
    expect(data.page).toBe(2);
    expect(data.rows).toEqual([
      {
        entityKey: "deepseek-v4",
        entityType: "model",
        vendor: "deepseek",
        eventCount: 2,
        lastAt: lastA.toISOString(),
        latestEventType: "release",
        latestTitle: "DeepSeek V4 发布",
        latestUrl: "https://api-docs.deepseek.com/news/v4",
      },
      {
        entityKey: "claude-opus-5-5",
        entityType: "",
        vendor: "",
        eventCount: 1,
        lastAt: "2026-10-28T02:00:00.000Z",
        latestEventType: "",
        latestTitle: "claude-opus-5-5",
        latestUrl: "",
      },
    ]);
    expect(entityGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["entityKey"],
        skip: 50,
        take: 50,
        orderBy: [{ _max: { occurredAt: "desc" } }, { entityKey: "asc" }],
      }),
    );
    expect(entityFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entityType: "model",
          entityKey: { in: ["deepseek-v4", "claude-opus-5-5"] },
        },
      }),
    );
  });
});

describe("getEntityDetail", () => {
  it("事件与关联信号皆空回 null", async () => {
    entityFindMany.mockResolvedValue([]);
    entityCount.mockResolvedValue(0);
    entityGroupBy.mockResolvedValue([]);
    signalFindMany.mockResolvedValue([]);
    expect(await getEntityDetail("ghost")).toBeNull();
  });

  it("返回事件时间线 + 去重厂商/类型 + 关联信号", async () => {
    entityFindMany.mockResolvedValue([
      {
        dedupeKey: "d1",
        vendor: "deepseek",
        entityType: "model",
        eventType: "release",
        title: "发布",
        summary: null,
        url: "https://x.test/a",
        occurredAt: new Date("2026-10-29T02:00:00Z"),
      },
    ]);
    entityCount.mockResolvedValue(3);
    entityGroupBy.mockResolvedValue([
      { vendor: "deepseek", entityType: "model", _count: { _all: 2 } },
      { vendor: "qwen", entityType: "model", _count: { _all: 1 } },
    ]);
    signalFindMany.mockResolvedValue([
      {
        id: BigInt(7),
        source: "vendor-deepseek",
        medium: "ai-record",
        lang: "en",
        region: "cn",
        rawText: "DeepSeek V4 released",
        translatedText: "DeepSeek V4 发布",
        translationStatus: "done",
        signalAt: new Date("2026-10-29T03:00:00Z"),
        meta: { entityKey: "deepseek-v4", url: "https://x.test/a" },
      },
    ]);
    const detail = await getEntityDetail("deepseek-v4");
    expect(detail).not.toBeNull();
    expect(detail?.eventCount).toBe(3);
    expect(detail?.vendors).toEqual(["deepseek", "qwen"]);
    expect(detail?.entityTypes).toEqual(["model"]);
    expect(detail?.events[0].occurredAt).toBe("2026-10-29T02:00:00.000Z");
    expect(detail?.signals[0].url).toBe("https://x.test/a");
    // 关联信号走 meta.entityKey JSON path 且恒限在役源
    expect(signalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { source: { in: expect.any(Array) } },
            { meta: { path: ["entityKey"], equals: "deepseek-v4" } },
          ],
        },
      }),
    );
  });
});
