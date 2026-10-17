/**
 * 渲染客户端纯函数单测(M31 批B):站内媒体路径 → file:// 绝对路径改写
 * (src 与 css url() 两形态;非站内前缀不动)。
 */
import { describe, expect, it } from "vitest";

import { rewriteLocalMediaRefs } from "./render";

describe("rewriteLocalMediaRefs", () => {
  it("img src 站内路径 → file:// 媒体根", () => {
    const out = rewriteLocalMediaRefs(
      '<img src="/wp-content/uploads/2026/10/a.png">',
      "/app/media",
    );
    expect(out).toBe('<img src="file:///app/media/2026/10/a.png">');
  });

  it("css url() 站内路径 → file:// 媒体根", () => {
    const out = rewriteLocalMediaRefs(
      "<style>.a{background:url(/wp-content/uploads/b.webp)}</style>",
      "/app/media",
    );
    expect(out).toContain("url(file:///app/media/b.webp)");
  });

  it("data: 与外链 src 不动", () => {
    const html = '<img src="data:image/png;base64,AA==" data-x="1"><img src="https://x.com/y.png">';
    expect(rewriteLocalMediaRefs(html, "/app/media")).toBe(html);
  });

  it("带尾斜杠的媒体根不产生双斜杠", () => {
    const out = rewriteLocalMediaRefs('<img src="/wp-content/uploads/a.png">', "/app/media/");
    expect(out).toBe('<img src="file:///app/media/a.png">');
  });
});
