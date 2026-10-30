/** 实体聚合视图单测(prisma mock,无真库):筛选钳制/关键词清洗/key 形态/URL、
 * 三层分区列表(品牌 › 产品线 › 实体)、别名关键词命中、详情别名信号与归并跳转。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const eventGroupBy = vi.fn();
const eventFindMany = vi.fn();
const eventCount = vi.fn();
const entityFindMany = vi.fn();
const entityFindUnique = vi.fn();
const aliasFindMany = vi.fn();
const aliasGroupBy = vi.fn();
const signalFindMany = vi.fn();
const findEntity = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    entityEvent: {
      groupBy: (...a: unknown[]) => eventGroupBy(...a),
      findMany: (...a: unknown[]) => eventFindMany(...a),
      count: (...a: unknown[]) => eventCount(...a),
    },
    insightEntity: {
      findMany: (...a: unknown[]) => entityFindMany(...a),
      findUnique: (...a: unknown[]) => entityFindUnique(...a),
    },
    insightEntityAlias: {
      findMany: (...a: unknown[]) => aliasFindMany(...a),
      groupBy: (...a: unknown[]) => aliasGroupBy(...a),
    },
    insightSignal: {
      findMany: (...a: unknown[]) => signalFindMany(...a),
    },
  },
}));

vi.mock("./entities/resolve", () => ({
  findEntity: (...a: unknown[]) => findEntity(...a),
}));

import {
  ENTITIES_PATH,
  entityHref,
  entityListHref,
  getEntityDetail,
  isCanonicalEntityKey,
  listEntityTree,
  resolveEntityFilters,
  sanitizeEntityQuery,
} from "./entities-admin";

beforeEach(() => {
  // reset 而非 clear:mockResolvedValueOnce 的排队值要一并丢弃(跨用例串扰)
  vi.resetAllMocks();
});

describe("resolveEntityFilters / sanitizeEntityQuery", () => {
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

  it("关键词 trim / 截断 40 / 去 ILIKE 元字符 / 空串不筛", () => {
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

const QWEN_ORG = {
  id: BigInt(1),
  key: "qwen",
  displayName: "Qwen",
  entityType: "org",
  vendorKey: "qwen",
  parentId: null,
  status: "active",
  mergedIntoId: null,
};
const QWEN3 = {
  id: BigInt(2),
  key: "qwen3",
  displayName: "qwen3",
  entityType: "model",
  vendorKey: "qwen",
  parentId: BigInt(1),
  status: "active",
  mergedIntoId: null,
};
const QWEN3_EMB = {
  id: BigInt(3),
  key: "qwen3-embedding",
  displayName: "qwen3-embedding",
  entityType: "model",
  vendorKey: "qwen",
  parentId: BigInt(2),
  status: "active",
  mergedIntoId: null,
};
const LAST_A = new Date("2026-10-29T02:00:00Z");

function primeList(): void {
  eventGroupBy.mockResolvedValue([
    { entityId: BigInt(2), _count: { _all: 2 }, _max: { occurredAt: LAST_A } },
    {
      entityId: BigInt(3),
      _count: { _all: 1 },
      _max: { occurredAt: new Date("2026-10-28T02:00:00Z") },
    },
  ]);
  eventCount.mockResolvedValue(7);
  entityFindMany
    .mockResolvedValueOnce([QWEN3, QWEN3_EMB]) // 本页实体
    .mockResolvedValueOnce([QWEN_ORG]); // 祖先补齐
  eventFindMany.mockResolvedValue([
    {
      entityId: BigInt(2),
      vendor: "qwen",
      entityType: "model",
      eventType: "release",
      title: "Qwen3 发布",
      url: "https://qwen.test/3",
    },
    {
      entityId: BigInt(3),
      vendor: "qwen",
      entityType: "model",
      eventType: "open_source",
      title: "Qwen3-Embedding 开源",
      url: "https://qwen.test/emb",
    },
  ]);
  aliasGroupBy.mockResolvedValue([{ entityId: BigInt(2), _count: { _all: 2 } }]);
}

describe("listEntityTree", () => {
  it("按顶层品牌分区,产品线取直接父级,最近事件同实体只取首条", async () => {
    primeList();
    const data = await listEntityTree({ page: 1 });
    expect(data.total).toBe(2);
    expect(data.unresolved).toBe(7);
    expect(data.sections).toHaveLength(1);
    const section = data.sections[0];
    expect(section.rootKey).toBe("qwen");
    expect(section.rootName).toBe("Qwen");
    expect(section.eventCount).toBe(3);
    expect(section.rows.map((r) => r.key).sort()).toEqual(["qwen3", "qwen3-embedding"]);
    const qwen3 = section.rows.find((r) => r.key === "qwen3");
    expect(qwen3).toMatchObject({
      parentKey: "qwen",
      rootKey: "qwen",
      aliasCount: 2,
      eventCount: 2,
      latestEventType: "release",
      latestTitle: "Qwen3 发布",
      lastAt: LAST_A.toISOString(),
    });
    const emb = section.rows.find((r) => r.key === "qwen3-embedding");
    expect(emb).toMatchObject({ parentKey: "qwen3", aliasCount: 0, eventCount: 1 });
  });

  it("关键词命中别名时也保留该实体", async () => {
    primeList();
    aliasFindMany.mockResolvedValue([{ entityId: BigInt(3) }]);
    const data = await listEntityTree({ q: "embedding", page: 1 });
    // 规范键本身能命中;别名命中路径由 insight_entity_alias 查询参与过滤
    expect(aliasFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { aliasKey: { contains: "embedding", mode: "insensitive" } },
      }),
    );
    expect(data.sections[0].rows.map((r) => r.key)).toEqual(["qwen3-embedding"]);
  });

  it("分页切片按实体粒度,超页时 pages 折算", async () => {
    primeList();
    const data = await listEntityTree({ page: 2, vendor: "qwen" });
    expect(data.total).toBe(2);
    expect(data.pages).toBe(1);
    expect(eventGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["entityId"], where: { entityId: { not: null } } }),
    );
  });
});

describe("getEntityDetail", () => {
  it("查无实体且无事件回 null", async () => {
    findEntity.mockResolvedValue(null);
    eventFindMany.mockResolvedValue([]);
    eventCount.mockResolvedValue(0);
    eventGroupBy.mockResolvedValue([]);
    signalFindMany.mockResolvedValue([]);
    expect(await getEntityDetail("ghost")).toBeNull();
  });

  it("命中已归并实体时给跳转目标", async () => {
    findEntity.mockResolvedValue({ id: BigInt(9), key: "qwen-vlo" });
    entityFindUnique
      .mockResolvedValueOnce({
        ...QWEN3,
        id: BigInt(9),
        key: "qwen-vlo",
        status: "merged",
        mergedIntoId: BigInt(2),
      })
      .mockResolvedValueOnce({ key: "qwen3" });
    const detail = await getEntityDetail("qwen-vlo");
    expect(detail?.redirectTo).toBe("qwen3");
  });

  it("事件时间线 + 别名集合关联信号 + 子实体", async () => {
    findEntity.mockResolvedValue({ id: BigInt(2), key: "qwen3" });
    entityFindUnique.mockResolvedValue(QWEN3);
    aliasFindMany.mockResolvedValue([
      { aliasKey: "qwen3" },
      { aliasKey: "qwen-3" },
      { aliasKey: "qwen3.0" },
    ]);
    eventFindMany.mockResolvedValue([
      {
        dedupeKey: "d1",
        vendor: "qwen",
        entityType: "model",
        eventType: "release",
        title: "发布",
        summary: null,
        url: "https://qwen.test/3",
        occurredAt: new Date("2026-10-29T02:00:00Z"),
      },
    ]);
    eventCount.mockResolvedValue(2);
    eventGroupBy
      .mockResolvedValueOnce([{ vendor: "qwen", entityType: "model", _count: { _all: 2 } }]) // facets
      .mockResolvedValueOnce([{ entityId: BigInt(3), _count: { _all: 1 } }]); // 子实体计数
    entityFindMany
      .mockResolvedValueOnce([QWEN_ORG]) // 祖先
      .mockResolvedValueOnce([
        { id: BigInt(3), key: "qwen3-embedding", displayName: "qwen3-embedding" },
      ]) // 子
      .mockResolvedValueOnce([]); // 兄弟
    signalFindMany.mockResolvedValue([]);

    const detail = await getEntityDetail("qwen3");
    expect(detail?.eventCount).toBe(2);
    expect(detail?.root).toEqual({ key: "qwen", displayName: "Qwen" });
    expect(detail?.parent).toEqual({ key: "qwen", displayName: "Qwen" });
    expect(detail?.aliases).toEqual(["qwen3", "qwen-3", "qwen3.0"]);
    expect(detail?.children).toEqual([
      { key: "qwen3-embedding", displayName: "qwen3-embedding", eventCount: 1 },
    ]);
    expect(detail?.events[0].occurredAt).toBe("2026-10-29T02:00:00.000Z");
    // 信号按别名集合 OR 匹配(历史写法与现行写法同实体)
    expect(signalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { source: { in: expect.any(Array) } },
            {
              OR: [
                { meta: { path: ["entityKey"], equals: "qwen3" } },
                { meta: { path: ["entityKey"], equals: "qwen-3" } },
                { meta: { path: ["entityKey"], equals: "qwen3.0" } },
              ],
            },
          ],
        },
      }),
    );
  });
});
