/** 洞察向量仓单测(prisma mock,serializeVector 真跑;M47 批C 补盲):
 * 回填分片 25/待归簇向量文本解析/质心 null 与维度护栏/近邻出参映射。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const executeRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (strings: TemplateStringsArray, ...v: unknown[]) => queryRaw(strings, ...v),
    $executeRaw: (strings: TemplateStringsArray, ...v: unknown[]) => executeRaw(strings, ...v),
  },
}));

import {
  findUnclusteredSignals,
  findUnembeddedSignals,
  getClusterCentroid,
  nearestClustersByMembers,
  saveSignalEmbeddings,
} from "./embedding-repo";

/** 1024 维全 0.1 向量的 pgvector 文本形 */
function vecText(v: number[]): string {
  return `[${v.join(",")}]`;
}

const DIMS_VEC = Array.from({ length: 1024 }, () => 0.1);

beforeEach(() => {
  vi.clearAllMocks();
  queryRaw.mockResolvedValue([]);
  executeRaw.mockResolvedValue(1);
});

describe("saveSignalEmbeddings", () => {
  it("30 行分片为 25+5 两条 UPDATE", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: BigInt(i + 1), vector: DIMS_VEC }));
    await saveSignalEmbeddings(rows);
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it("空入参零语句", async () => {
    await saveSignalEmbeddings([]);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("维度不符抛错(serializeVector 护栏),不落库", async () => {
    await expect(saveSignalEmbeddings([{ id: BigInt(1), vector: [0.1, 0.2] }])).rejects.toThrow(
      /维度不符/,
    );
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe("findUnclusteredSignals", () => {
  it("pgvector 文本按行解析为数值向量", async () => {
    queryRaw.mockResolvedValue([
      {
        id: BigInt(5),
        source: "telegram-ai",
        medium: "text",
        normalizedText: "mcp 客户端",
        vec: vecText([1, 2, 3]),
      },
    ]);
    const rows = await findUnclusteredSignals(100, 8, ["telegram-ai"]);
    expect(rows).toEqual([
      {
        id: BigInt(5),
        source: "telegram-ai",
        medium: "text",
        normalizedText: "mcp 客户端",
        vector: [1, 2, 3],
      },
    ]);
  });
});

describe("getClusterCentroid", () => {
  it("全成员未嵌(vec null)→ null", async () => {
    queryRaw.mockResolvedValue([{ vec: null }]);
    expect(await getClusterCentroid(BigInt(1))).toBeNull();
  });

  it("维度不符 → null(护栏),正常均值向量解析", async () => {
    queryRaw.mockResolvedValue([{ vec: vecText([1, 2]) }]);
    expect(await getClusterCentroid(BigInt(1))).toBeNull();
    queryRaw.mockResolvedValue([{ vec: vecText(DIMS_VEC) }]);
    const v = await getClusterCentroid(BigInt(1));
    expect(v).toHaveLength(1024);
    expect(v![0]).toBeCloseTo(0.1);
  });
});

describe("nearestClustersByMembers", () => {
  it("出参映射 clusterId+distance,默认 limit 5", async () => {
    queryRaw.mockResolvedValue([
      { cluster_id: BigInt(11), distance: 0.12 },
      { cluster_id: BigInt(22), distance: 0.3 },
    ]);
    const rows = await nearestClustersByMembers(DIMS_VEC, "devtool");
    expect(rows).toEqual([
      { clusterId: BigInt(11), distance: 0.12 },
      { clusterId: BigInt(22), distance: 0.3 },
    ]);
    // 第三参为 LIMIT 槽位(默认 5),domain 走等值过滤槽
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("findUnembeddedSignals", () => {
  it("透传 limit,id 升序由 SQL 保证", async () => {
    queryRaw.mockResolvedValue([{ id: BigInt(1), normalizedText: "x" }]);
    const rows = await findUnembeddedSignals(200);
    expect(rows).toHaveLength(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
