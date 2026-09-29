import { describe, expect, it } from "vitest";

import { isSameOrigin } from "./origin";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://17aitech.com/api/view", { method: "POST", headers });
}

describe("isSameOrigin(mutation 类 Handler 的 CSRF 补位,04 文档 §4)", () => {
  it("Origin 与 Host 一致 → true", () => {
    expect(isSameOrigin(reqWith({ host: "17aitech.com", origin: "https://17aitech.com" }))).toBe(
      true,
    );
  });

  it("Referer 兜底(Origin 缺失)", () => {
    expect(
      isSameOrigin(reqWith({ host: "17aitech.com", referer: "https://17aitech.com/articles/" })),
    ).toBe(true);
  });

  it("跨域 Origin → false", () => {
    expect(isSameOrigin(reqWith({ host: "17aitech.com", origin: "https://evil.example" }))).toBe(
      false,
    );
  });

  it("端口不一致 → false", () => {
    expect(isSameOrigin(reqWith({ host: "localhost:3000", origin: "http://localhost:4000" }))).toBe(
      false,
    );
  });

  it("无 Origin 且无 Referer → false", () => {
    expect(isSameOrigin(reqWith({ host: "17aitech.com" }))).toBe(false);
  });

  it("x-forwarded-host 链取第一跳", () => {
    expect(
      isSameOrigin(
        reqWith({ "x-forwarded-host": "17aitech.com, proxy:8080", origin: "https://17aitech.com" }),
      ),
    ).toBe(true);
  });
});
