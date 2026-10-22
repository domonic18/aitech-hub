/**
 * 配图工坊服务层单测(M40 批 B,全 mock):bbox 形态校验/根版本 get-or-create/
 * 拆层入队防线(版本缺失 not_found、processing 重复 conflict 409、绑定溯源
 * 主备选边)/候选确认成版本/编辑器取数(链回溯根→当前、BigInt Number 化、
 * 图层 z 升序)/图层显隐。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    illustrationVersion: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    illustrationLayerGroup: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    illustrationLayer: { findUnique: vi.fn(), update: vi.fn() },
    aiTaskBinding: { findUnique: vi.fn() },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const queueAdd = vi.hoisted(() => vi.fn());
vi.mock("../queue", () => ({
  QUEUE_ILLUSTRATION_STUDIO: "illustration-studio",
  ILLUSTRATION_JOB_DECOMPOSE: "decompose",
  getQueue: vi.fn(() => ({ add: queueAdd })),
}));

import { prisma } from "../db";
import { AiAdminError } from "./errors";
import {
  confirmEditVersion,
  enqueueDecompose,
  ensureStudioRoot,
  getStudioView,
  isValidNormalizedBbox,
  setLayerVisible,
} from "./illustration-studio";

const vFindFirst = vi.mocked(prisma.illustrationVersion.findFirst);
const vFindUnique = vi.mocked(prisma.illustrationVersion.findUnique);
const vCreate = vi.mocked(prisma.illustrationVersion.create);
const gFindFirst = vi.mocked(prisma.illustrationLayerGroup.findFirst);
const gCreate = vi.mocked(prisma.illustrationLayerGroup.create);
const lFindUnique = vi.mocked(prisma.illustrationLayer.findUnique);
const lUpdate = vi.mocked(prisma.illustrationLayer.update);
const bFindUnique = vi.mocked(prisma.aiTaskBinding.findUnique);

const NOW = new Date("2026-10-22T03:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  queueAdd.mockResolvedValue(undefined);
  gCreate.mockResolvedValue({ id: BigInt(901) } as never);
  vCreate.mockResolvedValue({ id: BigInt(502) } as never);
});

describe("isValidNormalizedBbox", () => {
  it("四段 0-999 整数为真;越界/段数不足/非数字为假", () => {
    expect(isValidNormalizedBbox("1 22 333 999")).toBe(true);
    expect(isValidNormalizedBbox("  0   0   999   999 ")).toBe(true);
    expect(isValidNormalizedBbox("1000 1 2 3")).toBe(false);
    expect(isValidNormalizedBbox("1 2 3")).toBe(false);
    expect(isValidNormalizedBbox("a b c d")).toBe(false);
    expect(isValidNormalizedBbox("-1 2 3 4")).toBe(false);
  });
});

describe("ensureStudioRoot(根版本 get-or-create)", () => {
  it("同图已有根版本 → 复用不建新行", async () => {
    vFindFirst.mockResolvedValueOnce({ id: BigInt(501) } as never);
    const r = await ensureStudioRoot("/wp-content/uploads/a.png");
    expect(r).toEqual({ versionId: BigInt(501) });
    expect(vCreate).not.toHaveBeenCalled();
  });

  it("首次出图 → 建 origin=original 根版本", async () => {
    vFindFirst.mockResolvedValueOnce(null);
    const r = await ensureStudioRoot("/wp-content/uploads/a.png");
    expect(r).toEqual({ versionId: BigInt(502) });
    expect(vCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { mediaPath: "/wp-content/uploads/a.png", origin: "original" },
      }),
    );
  });
});

describe("enqueueDecompose(拆层入队)", () => {
  it("版本不存在 → not_found,不建组不入队", async () => {
    vFindUnique.mockResolvedValueOnce(null);
    await expect(enqueueDecompose(BigInt(404))).rejects.toThrow(AiAdminError);
    expect(gCreate).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("已有 processing 组 → conflict 人话拒(防重复计费双拆)", async () => {
    vFindUnique.mockResolvedValueOnce({ id: BigInt(501) } as never);
    gFindFirst.mockResolvedValueOnce({ id: BigInt(900) } as never);
    await expect(enqueueDecompose(BigInt(501))).rejects.toThrow("拆层任务进行中");
    expect(gCreate).not.toHaveBeenCalled();
  });

  it("主力启用 → 溯源 modelId=主力;jobId 锚 groupId,attempts=1 不自动重试", async () => {
    vFindUnique.mockResolvedValueOnce({ id: BigInt(501) } as never);
    gFindFirst.mockResolvedValueOnce(null);
    bFindUnique.mockResolvedValueOnce({
      role: "illustrate",
      primary: { id: 11, enabled: true },
      backup: { id: 22, enabled: true },
    } as never);
    const r = await enqueueDecompose(BigInt(501));
    expect(gCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { versionId: BigInt(501), status: "processing", modelId: 11 },
      }),
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "decompose",
      { groupId: 901 },
      expect.objectContaining({ jobId: "illu-decompose-901", attempts: 1 }),
    );
    expect(r).toEqual({ groupId: BigInt(901) });
  });

  it("主力停用 → 用启用中的备用;全停/无绑定 → modelId=0", async () => {
    vFindUnique.mockResolvedValue({ id: BigInt(501) } as never);
    gFindFirst.mockResolvedValue(null);
    bFindUnique.mockResolvedValueOnce({
      role: "illustrate",
      primary: { id: 11, enabled: false },
      backup: { id: 22, enabled: true },
    } as never);
    await enqueueDecompose(BigInt(501));
    expect(gCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ modelId: 22 }) }),
    );
    bFindUnique.mockResolvedValueOnce({
      role: "illustrate",
      primary: { id: 11, enabled: false },
      backup: { id: 22, enabled: false },
    } as never);
    await enqueueDecompose(BigInt(501));
    expect(gCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ modelId: 0 }) }),
    );
  });
});

describe("confirmEditVersion(候选确认成版本)", () => {
  it("父版本不存在 → not_found", async () => {
    vFindUnique.mockResolvedValueOnce(null);
    await expect(
      confirmEditVersion(BigInt(404), {
        imagePath: "/wp-content/uploads/c.png",
        origin: "text_edit",
        instruction: "X",
      }),
    ).rejects.toThrow("父版本不存在");
  });

  it("沿 parent 单链追加,编辑元数据随行", async () => {
    vFindUnique.mockResolvedValueOnce({ id: BigInt(501) } as never);
    const r = await confirmEditVersion(BigInt(501), {
      imagePath: "/wp-content/uploads/c.png",
      origin: "erase",
      instruction: "去掉水印角标",
      bbox: "10 20 30 40",
    });
    expect(r).toEqual({ versionId: BigInt(502) });
    expect(vCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mediaPath: "/wp-content/uploads/c.png",
          parentVersionId: BigInt(501),
          origin: "erase",
          editInstruction: "去掉水印角标",
          editBbox: "10 20 30 40",
        }),
      }),
    );
  });
});

describe("getStudioView(编辑器取数)", () => {
  it("版本不存在 → null", async () => {
    vFindUnique.mockResolvedValueOnce(null);
    await expect(getStudioView(BigInt(404))).resolves.toBeNull();
  });

  it("链回溯根→当前 + BigInt Number 化 + 图层 z 升序透传", async () => {
    const root = {
      id: BigInt(501),
      origin: "original",
      createdAt: NOW,
      parentVersionId: null,
      mediaPath: "/a.png",
    };
    const mid = { ...root, id: BigInt(502), origin: "text_edit", parentVersionId: BigInt(501) };
    // 实现先查当前版本再逐级向上:按调用序桩 502 → 501
    vFindUnique.mockResolvedValueOnce(mid as never).mockResolvedValueOnce(root as never);
    gFindFirst.mockResolvedValueOnce({
      id: BigInt(901),
      status: "ready",
      error: null,
      baseMediaPath: "/base.jpg",
      createdAt: NOW,
      layers: [
        {
          id: BigInt(1),
          zIndex: 1,
          name: "文字",
          description: "标题",
          bboxX1: 5,
          bboxY1: 6,
          bboxX2: 7,
          bboxY2: 8,
          mediaPath: "/l1.png",
          visible: false,
        },
        {
          id: BigInt(2),
          zIndex: 2,
          name: "配图",
          description: null,
          bboxX1: 1,
          bboxY1: 2,
          bboxX2: 3,
          bboxY2: 4,
          mediaPath: "/l2.png",
          visible: true,
        },
      ],
    } as never);
    const view = await getStudioView(BigInt(502));
    expect(view).not.toBeNull();
    expect(view!.chain.map((c) => c.id)).toEqual([501, 502]);
    expect(view!.chain.map((c) => c.origin)).toEqual(["original", "text_edit"]);
    expect(view!.version.id).toBe(502);
    expect(view!.latestGroup!.layers.map((l) => [l.id, l.zIndex])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(view!.latestGroup!.layers[0]).toMatchObject({ bbox: [5, 6, 7, 8], visible: false });
  });
});

describe("setLayerVisible(图层显隐)", () => {
  it("图层不存在 → not_found", async () => {
    lFindUnique.mockResolvedValueOnce(null);
    await expect(setLayerVisible(BigInt(404), true)).rejects.toThrow("图层不存在");
  });

  it("存在 → 落 visible 更新", async () => {
    lFindUnique.mockResolvedValueOnce({ id: BigInt(2) } as never);
    lUpdate.mockResolvedValueOnce({} as never);
    await setLayerVisible(BigInt(2), false);
    expect(lUpdate).toHaveBeenCalledWith({ where: { id: BigInt(2) }, data: { visible: false } });
  });
});
