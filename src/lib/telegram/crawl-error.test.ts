/**
 * crawl-error 单测:undici cause 链翻译——fetch failed+错误码、超时、
 * 无 cause 直通、未知码透出、消息不含 URL(token 不泄漏)。
 */
import { describe, expect, it } from "vitest";

import { describeCrawlError } from "./crawl-error";

describe("describeCrawlError", () => {
  it("fetch failed + cause 错误码 → 人话短语(生产「fetch failed」场景)", () => {
    const err = new TypeError("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND www.theverge.com"), {
        code: "ENOTFOUND",
      }),
    });
    expect(describeCrawlError(err)).toBe("fetch failed:DNS 解析失败(ENOTFOUND)");
  });

  it("连接重置/超时错误码各得短语", () => {
    const reset = new TypeError("fetch failed", {
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    });
    expect(describeCrawlError(reset)).toBe("fetch failed:连接被对端重置(ECONNRESET)");

    const timeout = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    });
    expect(describeCrawlError(timeout)).toBe("fetch failed:连接超时(UND_ERR_CONNECT_TIMEOUT)");
  });

  it("AbortSignal.timeout 抛的 TimeoutError 按名识别", () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    expect(describeCrawlError(err)).toBe("请求超时或中止(TimeoutError)");
  });

  it("无 cause 的业务错误原样透出(HTTP 状态类)", () => {
    expect(describeCrawlError(new Error("feed HTTP 503"))).toBe("feed HTTP 503");
  });

  it("未知错误码与无码 cause 透出原始信息", () => {
    const unknown = new TypeError("fetch failed", {
      cause: Object.assign(new Error("weird failure"), { code: "E_WEIRD" }),
    });
    expect(describeCrawlError(unknown)).toBe("fetch failed:E_WEIRD weird failure");

    const noCode = new TypeError("fetch failed", { cause: new Error("socket disconnected") });
    expect(describeCrawlError(noCode)).toBe("fetch failed:socket disconnected");
  });

  it("非 Error 值 String 化;错误信息不含 URL(token 不入日志)", () => {
    expect(describeCrawlError("boom")).toBe("boom");
    const err = new TypeError("fetch failed", {
      cause: Object.assign(new Error("x"), { code: "ENOTFOUND" }),
    });
    expect(describeCrawlError(err)).not.toContain("https://");
  });
});
