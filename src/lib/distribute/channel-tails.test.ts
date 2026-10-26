/** 渠道尾注单测(2026-10-20 问题四回归锚):正文渠道中性化的配套——
 * 尾注必须含「阅读原文」钩子与站名,且保持 blockquote 形态。 */
import { describe, expect, it } from "vitest";

import { wechatTail } from "./channel-tails";

describe("wechatTail(公众号渠道尾注)", () => {
  it("blockquote 形态,含「阅读原文」钩子与站名「一起AI」", () => {
    const tail = wechatTail();
    expect(tail.startsWith("> ")).toBe(true);
    expect(tail).toContain("阅读原文");
    expect(tail).toContain("一起AI");
  });
});
