/**
 * 飞书免登配置单例单测(prisma/secret-box/logger 全 mock):schema 边界、
 * update 留空保留旧钥语义、get-or-create 首访落默认行、运行时解密失败归 null fail-closed
 * 重录、行缺失返回 null 不写库、探针结果落 lastTest 四件套。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    adminFeishuConfig: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../crypto/secret-box", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (c: string) => {
    if (typeof c === "string" && c.startsWith("enc:")) return c.slice(4);
    return null;
  },
  maskSecret: (s: string) => `${s.slice(0, 2)}****`,
}));

import { prisma } from "../db";
import {
  FeishuConfigUpdateSchema,
  getFeishuConfigAdmin,
  getFeishuRuntimeConfig,
  recordFeishuTest,
  updateFeishuConfig,
} from "./feishu-config";

const mockedFind = vi.mocked(prisma.adminFeishuConfig.findUnique);
const mockedCreate = vi.mocked(prisma.adminFeishuConfig.create);
const mockedUpdate = vi.mocked(prisma.adminFeishuConfig.update);

function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 1,
    appId: "cli_x",
    appSecretEnc: "enc:real-secret",
    appSecretMask: "re****",
    enabled: true,
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    lastTestLatencyMs: null,
    updatedAt: new Date("2026-10-14T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FeishuConfigUpdateSchema", () => {
  const valid = { appId: "cli_x", enabled: false };

  it("合法通过;appSecret 可省略", () => {
    expect(FeishuConfigUpdateSchema.safeParse(valid).success).toBe(true);
    expect(FeishuConfigUpdateSchema.safeParse({ ...valid, appSecret: "s" }).success).toBe(true);
  });

  it("空 AppID/超长 AppSecret 拒收", () => {
    expect(FeishuConfigUpdateSchema.safeParse({ ...valid, appId: " " }).success).toBe(false);
    expect(
      FeishuConfigUpdateSchema.safeParse({ ...valid, appSecret: "x".repeat(401) }).success,
    ).toBe(false);
  });
});

describe("getFeishuConfigAdmin", () => {
  it("行缺失 → get-or-create 默认行(appId 空)", async () => {
    mockedFind.mockResolvedValueOnce(null);
    mockedCreate.mockResolvedValueOnce(
      row({ appId: "", appSecretEnc: null, appSecretMask: null, enabled: false }) as never,
    );
    const view = await getFeishuConfigAdmin();
    expect(mockedCreate).toHaveBeenCalledWith({ data: { id: 1, appId: "" } });
    expect(view.appId).toBe("");
    expect(view.appSecretMask).toBeNull();
    expect(view.updatedAt).toBe("2026-10-14T00:00:00.000Z");
  });

  it("行存在 → 直接回脱敏视图(不含密文)", async () => {
    mockedFind.mockResolvedValueOnce(row() as never);
    const view = await getFeishuConfigAdmin();
    expect(JSON.stringify(view)).not.toContain("enc:");
    expect(view.appSecretMask).toBe("re****");
  });
});

describe("updateFeishuConfig", () => {
  it("appSecret 留空 = 保留旧钥(update data 不含密文键)", async () => {
    mockedFind.mockResolvedValue(row() as never);
    mockedUpdate.mockResolvedValue(row() as never);
    await updateFeishuConfig({ appId: "cli_new", appSecret: null, enabled: true });
    const data = mockedUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.appId).toBe("cli_new");
    expect(data).not.toHaveProperty("appSecretEnc");
    expect(data.enabled).toBe(true);
  });

  it("appSecret 非空 = 换钥重加密(密文 + 掩码同写)", async () => {
    mockedFind.mockResolvedValue(row() as never);
    mockedUpdate.mockResolvedValue(row() as never);
    await updateFeishuConfig({ appId: "cli_x", appSecret: " new-secret ", enabled: false });
    const data = mockedUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.appSecretEnc).toBe("enc:new-secret");
    expect(data.appSecretMask).toBe("ne****");
  });
});

describe("getFeishuRuntimeConfig", () => {
  it("行缺失 → null(只读链路不写库)", async () => {
    mockedFind.mockResolvedValueOnce(null);
    expect(await getFeishuRuntimeConfig()).toBeNull();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("解密失败(null)→ 整体归 null fail-closed(细节只进日志)", async () => {
    mockedFind.mockResolvedValueOnce(row({ appSecretEnc: "broken" }) as never);
    expect(await getFeishuRuntimeConfig()).toBeNull();
  });

  it("凭证齐 → enabled+解密 secret;无密文 → secret null", async () => {
    mockedFind.mockResolvedValueOnce(row() as never);
    expect(await getFeishuRuntimeConfig()).toMatchObject({
      enabled: true,
      appId: "cli_x",
      appSecret: "real-secret",
    });
    mockedFind.mockResolvedValueOnce(row({ appSecretEnc: null }) as never);
    expect((await getFeishuRuntimeConfig())?.appSecret).toBeNull();
  });
});

describe("recordFeishuTest", () => {
  it("失败详情截断 500 字;成功清 error", async () => {
    mockedUpdate.mockResolvedValue(row() as never);
    await recordFeishuTest({ ok: false, latencyMs: 12, detail: "x".repeat(600) });
    expect(mockedUpdate.mock.calls[0][0].data).toMatchObject({
      lastTestStatus: "fail",
      lastTestError: "x".repeat(500),
      lastTestLatencyMs: 12,
    });
    await recordFeishuTest({ ok: true, latencyMs: 30, detail: "ok" });
    expect(mockedUpdate.mock.calls[1][0].data).toMatchObject({
      lastTestStatus: "ok",
      lastTestError: null,
    });
  });
});
