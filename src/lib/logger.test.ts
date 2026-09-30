/** ipHash 单测:auth 事件的 IP 短哈希(不落明文 IP,与统计口径一致) */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { AUTH_SECRET: "test-secret-0123456789-abcdef" },
}));

import { ipHash } from "./logger";

describe("ipHash(sha256 前 16 位十六进制)", () => {
  it("输出 16 位十六进制小写", async () => {
    const h = await ipHash("203.0.113.9");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("确定性:同输入同输出", async () => {
    expect(await ipHash("203.0.113.9")).toBe(await ipHash("203.0.113.9"));
  });

  it("区分度:不同 IP 哈希不同", async () => {
    expect(await ipHash("203.0.113.9")).not.toBe(await ipHash("203.0.113.10"));
  });

  it("空串也可哈希(无代理头的本机请求)", async () => {
    expect(await ipHash("")).toMatch(/^[0-9a-f]{16}$/);
  });
});
