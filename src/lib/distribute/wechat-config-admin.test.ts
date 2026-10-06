/**
 * 公众号配置单例单测(prisma/secret-box/logger 全 mock):
 * schema 边界、update 留空保留旧钥语义、运行时解密失败指引重录、
 * isWechatReady 四分支、get-or-create 首访落默认行。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    wechatConfig: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../crypto/secret-box", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (c: string) => {
    if (typeof c === "string" && c.startsWith("enc:")) return c.slice(4);
    throw new Error("cipher auth failed");
  },
  maskSecret: (s: string) => `${s.slice(0, 2)}****`,
}));

import { prisma } from "../db";
import {
  WechatConfigUpdateSchema,
  getWechatConfigAdmin,
  getWechatForTest,
  getWechatRuntimeConfig,
  isWechatReady,
  updateWechatConfig,
} from "./wechat-config-admin";

const mockedFind = vi.mocked(prisma.wechatConfig.findUnique);
const mockedCreate = vi.mocked(prisma.wechatConfig.create);
const mockedUpdate = vi.mocked(prisma.wechatConfig.update);

function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 1,
    appid: "wx123",
    appSecretEnc: "enc:real-secret",
    appSecretMask: "re****",
    author: null,
    autoSyncEnabled: false,
    enabled: true,
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    lastTestLatencyMs: null,
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WechatConfigUpdateSchema", () => {
  const valid = { appid: "wx123", autoSyncEnabled: false, enabled: false };

  it("合法通过;appSecret/author 可省略", () => {
    expect(WechatConfigUpdateSchema.safeParse(valid).success).toBe(true);
    expect(
      WechatConfigUpdateSchema.safeParse({ ...valid, appSecret: "", author: "某作者" }).success,
    ).toBe(true);
  });

  it("空 AppID/超长 AppSecret 拒收", () => {
    expect(WechatConfigUpdateSchema.safeParse({ ...valid, appid: " " }).success).toBe(false);
    expect(
      WechatConfigUpdateSchema.safeParse({ ...valid, appSecret: "x".repeat(401) }).success,
    ).toBe(false);
  });
});

describe("getWechatConfigAdmin", () => {
  it("行缺失 → get-or-create 默认行(appid 空)", async () => {
    mockedFind.mockResolvedValueOnce(null);
    mockedCreate.mockResolvedValueOnce(
      row({ appid: "", appSecretEnc: null, appSecretMask: null }) as never,
    );
    const view = await getWechatConfigAdmin();
    expect(mockedCreate).toHaveBeenCalledWith({ data: { id: 1, appid: "" } });
    expect(view.appid).toBe("");
    expect(view.appSecretMask).toBeNull();
  });

  it("行存在 → 直接回脱敏视图(不含密文)", async () => {
    mockedFind.mockResolvedValueOnce(row() as never);
    const view = await getWechatConfigAdmin();
    expect(JSON.stringify(view)).not.toContain("enc:");
    expect(view.appSecretMask).toBe("re****");
  });
});

describe("updateWechatConfig", () => {
  it("appSecret 留空 = 保留旧钥(update data 不含密文键)", async () => {
    mockedFind.mockResolvedValue(row() as never);
    mockedUpdate.mockResolvedValue(row() as never);
    await updateWechatConfig({
      appid: "wx-new",
      appSecret: null,
      autoSyncEnabled: true,
      enabled: true,
    });
    const data = mockedUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.appid).toBe("wx-new");
    expect(data).not.toHaveProperty("appSecretEnc");
    expect(data.autoSyncEnabled).toBe(true);
  });

  it("appSecret 非空 = 换钥重加密(密文 + 掩码同写)", async () => {
    mockedFind.mockResolvedValue(row() as never);
    mockedUpdate.mockResolvedValue(row() as never);
    await updateWechatConfig({
      appid: "wx123",
      appSecret: " new-secret ",
      autoSyncEnabled: false,
      enabled: false,
    });
    const data = mockedUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.appSecretEnc).toBe("enc:new-secret");
    expect(data.appSecretMask).toBe("ne****");
  });
});

describe("getWechatRuntimeConfig / getWechatForTest", () => {
  it("行缺失 → null(只读链路不写库)", async () => {
    mockedFind.mockResolvedValueOnce(null);
    expect(await getWechatRuntimeConfig()).toBeNull();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("解密失败 → DistributeError(invalid) 指引重录", async () => {
    mockedFind.mockResolvedValueOnce(row({ appSecretEnc: "broken" }) as never);
    await expect(getWechatRuntimeConfig()).rejects.toMatchObject({ code: "invalid" });
  });

  it("author 空 → 管道缺省「一起AI」;凭证缺 → 探针拒", async () => {
    mockedFind.mockResolvedValueOnce(row({ author: "  " }) as never);
    const cfg = await getWechatRuntimeConfig();
    expect(cfg?.author).toBe("一起AI");

    mockedFind.mockResolvedValueOnce(row({ appSecretEnc: null }) as never);
    await expect(getWechatForTest()).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("isWechatReady", () => {
  it("enabled+凭证齐 → true", async () => {
    mockedFind.mockResolvedValueOnce(row() as never);
    expect(await isWechatReady()).toBe(true);
  });

  it("未启用 / 无 secret / 行缺失 → false(解密失败也不抛)", async () => {
    mockedFind.mockResolvedValueOnce(row({ enabled: false }) as never);
    expect(await isWechatReady()).toBe(false);

    mockedFind.mockResolvedValueOnce(row({ appSecretEnc: null }) as never);
    expect(await isWechatReady()).toBe(false);

    mockedFind.mockResolvedValueOnce(null);
    expect(await isWechatReady()).toBe(false);

    mockedFind.mockResolvedValueOnce(row({ appSecretEnc: "broken" }) as never);
    expect(await isWechatReady()).toBe(false);
  });
});
