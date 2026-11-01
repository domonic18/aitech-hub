/**
 * 飞书卡片链接 → 端内 AppLink(回归:裸 URL 会被系统浏览器打开,跳出去还要
 * 重新登录;端内打开才走 M29 静默免登)。
 */
import { describe, expect, it } from "vitest";

import { toFeishuInAppUrl } from "./alert";

describe("toFeishuInAppUrl", () => {
  it("用 AppLink 包裹并整体编码目标 URL", () => {
    const target = "https://17aitech.com/admin/wechat-mp/42/";
    const link = toFeishuInAppUrl(target);
    expect(link.startsWith("https://applink.feishu.cn/client/web_url/open?")).toBe(true);
    expect(link).toContain("mode=appCenter");
    expect(link).toContain(`url=${encodeURIComponent(target)}`);
    // 目标里的 :// 与 ? 不得以明文出现在外层,否则会被 fly 客户端当成裸 URL 直开
    expect(link.slice(link.indexOf("url=") + 4)).not.toContain("://");
  });

  it("解码后与目标完全一致(含 query 与中文)", () => {
    const target = "https://17aitech.com/admin/wechat-mp/?q=张三&page=2";
    const link = toFeishuInAppUrl(target);
    const encoded = new URL(link).searchParams.get("url");
    expect(encoded).toBe(target);
  });
});
