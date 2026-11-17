/**
 * 流式中断文案提取单测:服务端 error 帧的精确原因经 assistant-ui 挂在
 * status.error 上,前端须原样显示(此前统一显示通用「已中断」)。
 */
import { describe, expect, it } from "vitest";

import { extractStreamErrorText } from "./error-text";

describe("extractStreamErrorText", () => {
  it("error 帧的对象载荷 → 取 message", () => {
    expect(
      extractStreamErrorText({
        type: "incomplete",
        reason: "error",
        error: { message: "本会话用量已达上限,请新建会话继续" },
      }),
    ).toBe("本会话用量已达上限,请新建会话继续");
  });

  it("error 为字符串 → 直接用", () => {
    expect(extractStreamErrorText({ type: "incomplete", error: "处理中断,请重试" })).toBe(
      "处理中断,请重试",
    );
  });

  it("用户主动取消 → 「已取消」", () => {
    expect(extractStreamErrorText({ type: "incomplete", reason: "cancelled" })).toBe("已取消");
  });

  it("取不到原因 → null(调用方落通用兜底)", () => {
    expect(extractStreamErrorText(null)).toBeNull();
    expect(extractStreamErrorText(undefined)).toBeNull();
    expect(extractStreamErrorText({ type: "incomplete", reason: "error" })).toBeNull();
    expect(extractStreamErrorText({ type: "incomplete", error: { message: "  " } })).toBeNull();
    expect(extractStreamErrorText({ type: "incomplete", error: { code: 500 } })).toBeNull();
  });
});
