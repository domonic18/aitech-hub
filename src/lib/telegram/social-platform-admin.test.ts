/**
 * 网关健康观测单测:fetchGatewayHealth 是契约的消费端——成功样本直接复用
 * 网关侧黄金 fixture(health.success.json),漂移/不可达降级不炸页面渲染。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({ env: { DOUYIN_GATEWAY_URL: "http://gateway.test:8010" } }));
vi.mock("../env", () => envMock);
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./cookies", () => ({
  decryptJars: vi.fn(() => []),
  encryptJars: vi.fn(),
  maskJars: vi.fn(() => []),
  mergeImportedJar: vi.fn(),
  clearJarsInConfig: vi.fn((config: unknown) =>
    config !== null && typeof config === "object"
      ? Object.fromEntries(
          Object.entries(config as Record<string, unknown>).filter(([k]) => k !== "cookieJars"),
        )
      : null,
  ),
  CookiePoolError: class extends Error {},
}));
vi.mock("./bloggers-admin", () => ({
  BloggerAdminError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { logger } from "../logger";
import { fetchGatewayHealth } from "./social-platform-admin";

const HEALTH_FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../services/douyin-gateway/contract/health.success.json", import.meta.url),
    ),
    "utf8",
  ),
) as { status: number; body: unknown };

describe("fetchGatewayHealth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("契约样本(黄金 fixture)→ reachable 视图映射 jars 计数", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(HEALTH_FIXTURE.body), { status: 200 })),
    );
    await expect(fetchGatewayHealth()).resolves.toEqual({
      reachable: true,
      status: "starting",
      jarsTotal: 3,
      jarsAvailable: 2,
    });
  });

  it("响应不合契约 → 降级 reachable:false + warn(契约漂移要响)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ foo: "bar" }), { status: 200 })),
    );
    await expect(fetchGatewayHealth()).resolves.toEqual({ reachable: false });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "gateway.health.contract_drift" }),
    );
  });

  it("非 2xx / 连接失败 → 降级 reachable:false,不抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await expect(fetchGatewayHealth()).resolves.toEqual({ reachable: false });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(fetchGatewayHealth()).resolves.toEqual({ reachable: false });
  });
});
