/** 榜单 → 实体解析单测(prisma mock,无真库):只读口径、别名优先、HF 末段回退、
 * 合并跟随与链断降级、非实体化源直接返回 null 且不查库。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const aliasFindMany = vi.fn();
const entityFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    insightEntityAlias: {
      findMany: (...a: unknown[]) => aliasFindMany(...a),
    },
    insightEntity: {
      findMany: (...a: unknown[]) => entityFindMany(...a),
    },
  },
}));

import { resolveLeaderboardEntities, resolveLeaderboardEntity } from "./leaderboard";

function entity(
  id: number,
  key: string,
  matchKey = key,
  status = "active",
  mergedIntoId: number | null = null,
) {
  return {
    id: BigInt(id),
    key,
    matchKey,
    status,
    mergedIntoId: mergedIntoId === null ? null : BigInt(mergedIntoId),
  };
}

function alias(aliasKey: string, row: ReturnType<typeof entity>) {
  return { aliasKey, entity: row };
}

/** aliasFindMany 按请求键过滤;entityFindMany 先当 matchKey 查、再当 id 查(合并跟随) */
function wire(
  aliases: ReturnType<typeof alias>[],
  byMatch: ReturnType<typeof entity>[],
  byId: ReturnType<typeof entity>[] = [],
) {
  aliasFindMany.mockImplementation(async ({ where }: { where: { aliasKey: { in: string[] } } }) =>
    aliases.filter((a) => where.aliasKey.in.includes(a.aliasKey)),
  );
  entityFindMany.mockImplementation(
    async ({ where }: { where: { matchKey?: { in: string[] }; id?: { in: bigint[] } } }) => {
      if (where.matchKey !== undefined) {
        return byMatch.filter((r) => where.matchKey!.in.includes(r.matchKey));
      }
      if (where.id !== undefined) {
        return byId.filter((r) => where.id!.in.includes(r.id));
      }
      return [];
    },
  );
}

beforeEach(() => {
  aliasFindMany.mockReset();
  entityFindMany.mockReset();
});

describe("resolveLeaderboardEntities", () => {
  it("非实体化源直接返回 null,不查库", async () => {
    const map = await resolveLeaderboardEntities("github", ["owner/repo", "a/b"]);
    expect(map.get("owner/repo")).toBeNull();
    expect(map.get("a/b")).toBeNull();
    expect(aliasFindMany).not.toHaveBeenCalled();
    expect(entityFindMany).not.toHaveBeenCalled();
  });

  it("AA slug 经匹配键命中(大小写与分隔符变体)", async () => {
    const row = entity(1, "gpt-6.1-terra", "gpt-6-1-terra");
    wire([], [row]);
    const map = await resolveLeaderboardEntities("artificial-analysis", ["GPT-6.1-Terra"]);
    expect(map.get("GPT-6.1-Terra")).toEqual({ id: BigInt(1), key: "gpt-6.1-terra" });
  });

  it("别名优先于匹配键", async () => {
    const aliasRow = entity(2, "qwen-mt-turbo");
    const matchRow = entity(3, "qwen-mt-turbo-legacy");
    wire([alias("qwen-mt-turbo", aliasRow)], [matchRow]);
    const map = await resolveLeaderboardEntities("artificial-analysis", ["qwen-mt-turbo"]);
    expect(map.get("qwen-mt-turbo")).toEqual({ id: BigInt(2), key: "qwen-mt-turbo" });
  });

  it("HF 模型 id 全键未命中时退到末段", async () => {
    const row = entity(4, "qwen3-8b");
    wire([alias("qwen3-8b", row)], []);
    const map = await resolveLeaderboardEntities("huggingface", ["Qwen/Qwen3-8B"]);
    expect(map.get("Qwen/Qwen3-8B")).toEqual({ id: BigInt(4), key: "qwen3-8b" });
  });

  it("命中已归并实体时跟进到 active 目标", async () => {
    const merged = entity(5, "gpt-6", "gpt-6", "merged", 6);
    const target = entity(6, "gpt-6-1");
    wire([alias("gpt-6", merged)], [], [target]);
    const map = await resolveLeaderboardEntities("artificial-analysis", ["GPT-6"]);
    expect(map.get("GPT-6")).toEqual({ id: BigInt(6), key: "gpt-6-1" });
  });

  it("多级归并链逐跳追到最终 active 目标", async () => {
    const first = entity(10, "gpt-6", "gpt-6", "merged", 11);
    const second = entity(11, "gpt-6-1", "gpt-6-1", "merged", 12);
    const target = entity(12, "gpt-6-1-terra");
    wire([alias("gpt-6", first)], [], [second, target]);
    const map = await resolveLeaderboardEntities("artificial-analysis", ["GPT-6"]);
    expect(map.get("GPT-6")).toEqual({ id: BigInt(12), key: "gpt-6-1-terra" });
  });

  it("合并链断裂时返回 null,不挂错实体", async () => {
    const merged = entity(7, "old-key", "old-key", "merged", 8);
    wire([alias("old-key", merged)], [], []);
    const map = await resolveLeaderboardEntities("artificial-analysis", ["old-key"]);
    expect(map.get("old-key")).toBeNull();
  });

  it("未命中返回 null", async () => {
    wire([], []);
    const map = await resolveLeaderboardEntities("artificial-analysis", ["brand-new-model"]);
    expect(map.get("brand-new-model")).toBeNull();
  });

  it("批量只发一次别名查询与一次匹配键查询", async () => {
    wire([], []);
    await resolveLeaderboardEntities("artificial-analysis", ["a-1", "b-2", "c-3"]);
    expect(aliasFindMany).toHaveBeenCalledTimes(1);
    expect(entityFindMany).toHaveBeenCalledTimes(1);
  });
});

describe("resolveLeaderboardEntity", () => {
  it("单键包装", async () => {
    const row = entity(9, "claude-4-sonnet");
    wire([], [row]);
    await expect(
      resolveLeaderboardEntity("claude-4-sonnet", "artificial-analysis"),
    ).resolves.toEqual({
      id: BigInt(9),
      key: "claude-4-sonnet",
    });
  });
});
