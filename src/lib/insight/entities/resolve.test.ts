/** 实体解析单测(M60):规范化/匹配键/前缀父级纯函数 + 内存 fake prisma 的
 * 解析顺序(别名→匹配键→新建定父)、归并迁移与成环拒绝。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: bigint };

const store = vi.hoisted(() => ({
  entities: [] as Row[],
  aliases: [] as (Row & { aliasKey: string; entityId: bigint })[],
  events: [] as (Row & { entityId: bigint | null })[],
  seq: BigInt(0),
}));

/** 仅实现 resolve.ts 用到的子集(按 key/matchKey/id/aliasKey 查,create/upsert/update) */
vi.mock("@/lib/db", () => {
  const findEntity = (where: Record<string, unknown>): Row | null => {
    if ("key" in where) return store.entities.find((e) => e.key === where.key) ?? null;
    if ("matchKey" in where)
      return store.entities.find((e) => e.matchKey === where.matchKey) ?? null;
    if ("id" in where) return store.entities.find((e) => e.id === where.id) ?? null;
    return null;
  };
  const pick = (row: Row | null, select?: Record<string, unknown>) => {
    if (row === null) return null;
    if (!select) return row;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(select)) out[k] = row[k];
    return out;
  };
  return {
    prisma: {
      insightEntityAlias: {
        findUnique: async ({ where }: { where: { aliasKey: string } }) => {
          const alias = store.aliases.find((a) => a.aliasKey === where.aliasKey);
          if (!alias) return null;
          const entity = store.entities.find((e) => e.id === alias.entityId);
          return entity ? { entity: { id: entity.id, key: entity.key } } : null;
        },
        upsert: async ({
          where,
          create,
        }: {
          where: { aliasKey: string };
          create: { aliasKey: string; entityId: bigint; origin: string };
        }) => {
          const found = store.aliases.find((a) => a.aliasKey === where.aliasKey);
          if (found) return found;
          const row = { id: (store.seq += BigInt(1)), ...create };
          store.aliases.push(row);
          return row;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { entityId: bigint };
          data: { entityId: bigint; origin: string };
        }) => {
          const hit = store.aliases.filter((a) => a.entityId === where.entityId);
          for (const a of hit) Object.assign(a, data);
          return { count: hit.length };
        },
      },
      insightEntity: {
        findUnique: async ({
          where,
          select,
        }: {
          where: Record<string, unknown>;
          select?: Record<string, unknown>;
        }) => pick(findEntity(where), select),
        findMany: async ({
          where,
          select,
        }: {
          where: { vendorKey: string; status: string; entityType: { not: string } };
          select?: Record<string, unknown>;
        }) =>
          store.entities
            .filter(
              (e) =>
                e.vendorKey === where.vendorKey &&
                e.status === where.status &&
                e.entityType !== where.entityType.not,
            )
            .map((e) => pick(e, select)),
        create: async ({
          data,
          select,
        }: {
          data: Record<string, unknown>;
          select?: Record<string, unknown>;
        }) => {
          const row: Row = {
            id: (store.seq += BigInt(1)),
            status: "active",
            parentId: null,
            mergedIntoId: null,
            ...data,
          };
          store.entities.push(row);
          return pick(row, select);
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: bigint };
          data: Record<string, unknown>;
        }) => {
          const row = store.entities.find((e) => e.id === where.id);
          if (!row) throw new Error("not found");
          Object.assign(row, data);
          return row;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { parentId: bigint };
          data: { parentId: bigint };
        }) => {
          const hit = store.entities.filter((e) => e.parentId === where.parentId);
          for (const e of hit) Object.assign(e, data);
          return { count: hit.length };
        },
      },
      entityEvent: {
        updateMany: async ({
          where,
          data,
        }: {
          where: { entityId: bigint };
          data: { entityId: bigint };
        }) => {
          const hit = store.events.filter((e) => e.entityId === where.entityId);
          for (const e of hit) Object.assign(e, data);
          return { count: hit.length };
        },
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    },
  };
});

import {
  canonicalKey,
  findEntity,
  matchKeyOf,
  mergeEntities,
  pickParentKey,
  resolveEntity,
  vendorDisplayName,
} from "./resolve";

beforeEach(() => {
  store.entities.length = 0;
  store.aliases.length = 0;
  store.events.length = 0;
  store.seq = BigInt(0);
});

describe("canonicalKey / matchKeyOf", () => {
  it("规范键:trim/lower/空格转连字符,去空段与首尾连字符", () => {
    expect(canonicalKey("  Qwen3 Embedding ")).toBe("qwen3-embedding");
    expect(canonicalKey("qwen3--embedding")).toBe("qwen3--embedding"); // 规范键不动分隔符
    expect(canonicalKey("/qwen3/")).toBe("qwen3");
  });

  it("匹配键:`.`/`_`/重复 `-` 折叠,斜杠分段保留", () => {
    expect(matchKeyOf("GPT-6.1-Terra")).toBe("gpt-6-1-terra");
    expect(matchKeyOf("gpt-6-1-terra")).toBe("gpt-6-1-terra");
    expect(matchKeyOf("qwen3_embedding")).toBe("qwen3-embedding");
    expect(matchKeyOf("deepseek--v3-1")).toBe("deepseek-v3-1");
    expect(matchKeyOf("org/model_v1")).toBe("org/model-v1");
  });
});

describe("pickParentKey", () => {
  it("取 `-` 边界最长前缀", () => {
    expect(pickParentKey("qwen3-embedding", ["qwen", "qwen3"])).toBe("qwen3");
    expect(pickParentKey("qwen-image-edit", ["qwen", "qwen-image"])).toBe("qwen-image");
    expect(pickParentKey("qwen-mt-turbo", ["qwen", "qwen3"])).toBe("qwen");
  });

  it("无边界命中/自身不在候选内时回 null", () => {
    expect(pickParentKey("qwen3embedding", ["qwen3"])).toBeNull();
    expect(pickParentKey("qwen3", ["qwen3"])).toBeNull();
    expect(pickParentKey("kimi-k2", ["qwen"])).toBeNull();
  });
});

describe("vendorDisplayName", () => {
  it("注册厂商取官方名,未注册回退 key", () => {
    expect(vendorDisplayName("qwen")).toBe("Qwen");
    expect(vendorDisplayName("unknown-vendor")).toBe("unknown-vendor");
  });
});

describe("resolveEntity", () => {
  it("首次解析:先落厂商 org,模型挂其下并建别名", async () => {
    const model = await resolveEntity({
      vendorKey: "qwen",
      rawKey: "Qwen-MT-Turbo",
      entityType: "model",
    });
    expect(model?.key).toBe("qwen-mt-turbo");

    const org = store.entities.find((e) => e.entityType === "org");
    expect(org).toMatchObject({
      key: "qwen",
      displayName: "Qwen",
      vendorKey: "qwen",
      parentId: null,
    });

    const row = store.entities.find((e) => e.key === "qwen-mt-turbo");
    expect(row?.parentId).toBe(org?.id);
    expect(store.aliases.map((a) => a.aliasKey)).toContain("qwen-mt-turbo");
  });

  it("同厂商已有产品线时挂最近前缀父级,不再重复建 org", async () => {
    await resolveEntity({ vendorKey: "qwen", rawKey: "qwen3", entityType: "model" });
    const embedding = await resolveEntity({
      vendorKey: "qwen",
      rawKey: "qwen3-embedding",
      entityType: "model",
    });

    const parent = store.entities.find((e) => e.key === "qwen3");
    expect(store.entities.find((e) => e.id === embedding?.id)?.parentId).toBe(parent?.id);
    expect(store.entities.filter((e) => e.entityType === "org")).toHaveLength(1);
  });

  it("分隔符变体归同一实体(匹配键命中并补别名)", async () => {
    const a = await resolveEntity({
      vendorKey: "openai",
      rawKey: "gpt-6.1-terra",
      entityType: "model",
    });
    const b = await resolveEntity({
      vendorKey: "openai",
      rawKey: "gpt-6-1-terra",
      entityType: "model",
    });
    expect(b?.id).toBe(a?.id);
    expect(store.entities.filter((e) => e.key !== "openai")).toHaveLength(1);
    expect(store.aliases.map((x) => x.aliasKey)).toEqual(
      expect.arrayContaining(["gpt-6.1-terra", "gpt-6-1-terra"]),
    );
  });

  it("别名精确命中直接返回,不再新建", async () => {
    const first = await resolveEntity({ vendorKey: "qwen", rawKey: "qwen3", entityType: "model" });
    const aliasHits = store.aliases.length;
    const again = await resolveEntity({ vendorKey: "qwen", rawKey: "QWEN3", entityType: "model" });
    expect(again?.id).toBe(first?.id);
    expect(store.aliases.length).toBe(aliasHits);
  });

  it("厂商缺失时不挂父级", async () => {
    const e = await resolveEntity({ vendorKey: null, rawKey: "some-model", entityType: "model" });
    expect(store.entities.find((x) => x.id === e?.id)?.parentId).toBeNull();
  });

  it("空键回 null", async () => {
    expect(
      await resolveEntity({ vendorKey: "qwen", rawKey: "   ", entityType: "model" }),
    ).toBeNull();
    expect(store.entities).toHaveLength(0);
  });
});

describe("findEntity / mergeEntities", () => {
  it("别名路径可解析到主实体", async () => {
    await resolveEntity({ vendorKey: "openai", rawKey: "gpt-6.1-terra", entityType: "model" });
    const byAlias = await findEntity("gpt-6-1-terra");
    const byKey = await findEntity("gpt-6.1-terra");
    expect(byAlias?.id).toBe(byKey?.id);
  });

  it("归并迁移别名/事件/子实体,源实体置 merged", async () => {
    const from = await resolveEntity({
      vendorKey: "qwen",
      rawKey: "qwen-vlo",
      entityType: "model",
    });
    const to = await resolveEntity({ vendorKey: "qwen", rawKey: "qwen3-vl", entityType: "model" });
    store.events.push({ id: BigInt(1), entityId: from!.id }, { id: BigInt(2), entityId: from!.id });
    store.entities.push({
      id: BigInt(900),
      key: "qwen-vlo-mini",
      matchKey: "qwen-vlo-mini",
      displayName: "qwen-vlo-mini",
      entityType: "model",
      vendorKey: "qwen",
      parentId: from!.id,
      status: "active",
      mergedIntoId: null,
    });

    const out = await mergeEntities("qwen-vlo", "qwen3-vl");
    expect(out).toEqual({ movedAliases: 1, movedEvents: 2, movedChildren: 1 });
    expect(store.events.every((e) => e.entityId === to!.id)).toBe(true);
    expect(store.entities.find((e) => e.key === "qwen-vlo-mini")?.parentId).toBe(to!.id);
    expect(store.entities.find((e) => e.id === from!.id)).toMatchObject({
      status: "merged",
      mergedIntoId: to!.id,
    });
  });

  it("拒绝自并与成环", async () => {
    await resolveEntity({ vendorKey: "qwen", rawKey: "qwen3", entityType: "model" });
    await resolveEntity({ vendorKey: "qwen", rawKey: "qwen3-embedding", entityType: "model" });
    expect(await mergeEntities("qwen3", "qwen3")).toBe("not_found");
    // qwen3-embedding 是 qwen3 的子,把父并入子会成环
    expect(await mergeEntities("qwen3", "qwen3-embedding")).toBe("cycle");
    expect(await mergeEntities("missing", "qwen3")).toBe("not_found");
  });
});
