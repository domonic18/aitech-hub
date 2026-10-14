/**
 * 出口代理单例单测(M33 批B,prisma/secret-box/logger 全 mock,镜像
 * feishu-config.test):URL 形态校验、mask 剥凭据、update 留空保留旧址、
 * get-or-create 首访落默认行、运行时停用/解密失败归 null fail-closed、
 * 探针结果落 lastTest 四件套。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    systemProxyConfig: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../crypto/secret-box", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (c: string) => {
    if (typeof c === "string" && c.startsWith("enc:")) return c.slice(4);
    return null;
  },
  maskSecret: (s: string) => `${s.slice(0, 3)}****`,
}));

import { prisma } from "../db";
import {
  EgressProxyUpdateSchema,
  getEgressProxyConfigAdmin,
  getEgressProxyRuntime,
  maskProxyUrl,
  recordEgressProxyTest,
  updateEgressProxyConfig,
} from "./egress-proxy";

const mockedFind = vi.mocked(prisma.systemProxyConfig.findUnique);
const mockedCreate = vi.mocked(prisma.systemProxyConfig.create);
const mockedUpdate = vi.mocked(prisma.systemProxyConfig.update);

function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 1,
    proxyUrlEnc: null,
    proxyUrlMask: null,
    enabled: false,
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestError: null,
    lastTestLatencyMs: null,
    createdAt: new Date("2026-10-14T00:00:00Z"),
    updatedAt: new Date("2026-10-14T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("maskProxyUrl", () => {
  it("剥凭据只留 scheme://host:port", () => {
    expect(maskProxyUrl("socks5h://user:pa%3Ass@ddns.example.com:7890")).toBe(
      "socks5h://ddns.example.com:7890",
    );
    expect(maskProxyUrl("http://1.2.3.4:8080")).toBe("http://1.2.3.4:8080");
    expect(maskProxyUrl("http://1.2.3.4")).toBe("http://1.2.3.4"); // 无端口省略
  });

  it("坏 URL 归 ****(不抛)", () => {
    expect(maskProxyUrl("not a url")).toBe("****");
  });
});

describe("EgressProxyUpdateSchema", () => {
  it("http(s)/socks4/5(h) 形态通过;enabled 必填", () => {
    for (const url of [
      "http://1.2.3.4:8080",
      "https://proxy.example.com",
      "socks5://h:1",
      "socks5h://u:p@h:1",
    ]) {
      expect(EgressProxyUpdateSchema.safeParse({ proxyUrl: url, enabled: true }).success).toBe(
        true,
      );
    }
    expect(EgressProxyUpdateSchema.safeParse({ enabled: false }).success).toBe(true); // 留空保留旧址
    expect(EgressProxyUpdateSchema.safeParse({ enabled: true }).success).toBe(true);
  });

  it("非代理 scheme/超长/空串拒收", () => {
    expect(
      EgressProxyUpdateSchema.safeParse({ proxyUrl: "ftp://h:1", enabled: true }).success,
    ).toBe(false);
    expect(
      EgressProxyUpdateSchema.safeParse({ proxyUrl: "x".repeat(501), enabled: true }).success,
    ).toBe(false);
    expect(EgressProxyUpdateSchema.safeParse({ proxyUrl: "", enabled: true }).success).toBe(false);
    expect(EgressProxyUpdateSchema.safeParse({}).success).toBe(false); // enabled 必填
  });
});

describe("getEgressProxyConfigAdmin", () => {
  it("首访落默认行(get-or-create),视图不含密文", () => {
    mockedFind.mockResolvedValueOnce(null as never);
    mockedCreate.mockResolvedValueOnce(row() as never);
    const view = getEgressProxyConfigAdmin();
    return view.then((v) => {
      expect(mockedCreate).toHaveBeenCalledWith({ data: { id: 1 } });
      expect(v).toEqual({
        proxyUrlMask: null,
        enabled: false,
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestError: null,
        lastTestLatencyMs: null,
        updatedAt: "2026-10-14T00:00:00.000Z",
      });
      expect(Object.keys(v)).not.toContain("proxyUrlEnc");
    });
  });
});

describe("updateEgressProxyConfig", () => {
  it("填新址 → 重加密+换 mask;enabled 落库", async () => {
    mockedFind.mockResolvedValueOnce(row() as never);
    mockedUpdate.mockResolvedValueOnce(row() as never);
    await updateEgressProxyConfig({
      proxyUrl: "socks5h://u:p@ddns.example.com:7890",
      enabled: true,
    });
    const data = mockedUpdate.mock.calls[0]![0]!.data;
    expect(data.proxyUrlEnc).toBe("enc:socks5h://u:p@ddns.example.com:7890");
    expect(data.proxyUrlMask).toBe("socks5h://ddns.example.com:7890");
    expect(data.enabled).toBe(true);
  });

  it("留空 → 只改启停,密文与 mask 键不出现(保留旧址)", async () => {
    mockedFind.mockResolvedValueOnce(
      row({
        proxyUrlEnc: "enc:old",
        proxyUrlMask: "socks5h://old:1",
      }) as never,
    );
    mockedUpdate.mockResolvedValueOnce(row() as never);
    await updateEgressProxyConfig({ enabled: false });
    const data = mockedUpdate.mock.calls[0]![0]!.data;
    expect(data).not.toHaveProperty("proxyUrlEnc");
    expect(data).not.toHaveProperty("proxyUrlMask");
    expect(data.enabled).toBe(false);
  });
});

describe("getEgressProxyRuntime", () => {
  it("未配置/停用 → null(直连,零分叉)", async () => {
    mockedFind.mockResolvedValueOnce(row() as never);
    await expect(getEgressProxyRuntime()).resolves.toBeNull();
    mockedFind.mockResolvedValueOnce(row({ proxyUrlEnc: "enc:x" }) as never);
    await expect(getEgressProxyRuntime()).resolves.toBeNull();
  });

  it("解密失败(AUTH_SECRET 轮换)→ null fail-closed,等重录", async () => {
    mockedFind.mockResolvedValueOnce(
      row({ proxyUrlEnc: "rotated-away", enabled: true, proxyUrlMask: "http://h:1" }) as never,
    );
    await expect(getEgressProxyRuntime()).resolves.toBeNull();
  });

  it("启用且密文可用 → 回明文 URL(仅供随请求携带)", async () => {
    mockedFind.mockResolvedValueOnce(
      row({ proxyUrlEnc: "enc:http://1.2.3.4:8080", enabled: true }) as never,
    );
    await expect(getEgressProxyRuntime()).resolves.toEqual({
      proxyUrl: "http://1.2.3.4:8080",
    });
  });
});

describe("recordEgressProxyTest", () => {
  it("成功落 ok+清错;失败落 detail(截 500)", async () => {
    mockedUpdate.mockResolvedValue(row() as never);
    await recordEgressProxyTest({ ok: true, latencyMs: 233, detail: "" });
    expect(mockedUpdate.mock.calls[0]![0]!.data).toMatchObject({
      lastTestStatus: "ok",
      lastTestError: null,
      lastTestLatencyMs: 233,
    });
    await recordEgressProxyTest({ ok: false, latencyMs: 400, detail: "x".repeat(600) });
    expect(mockedUpdate.mock.calls[1]![0]!.data).toMatchObject({
      lastTestStatus: "fail",
      lastTestError: "x".repeat(500),
    });
  });
});
