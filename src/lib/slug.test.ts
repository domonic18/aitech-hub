import { describe, expect, it } from "vitest";

import { normalizeSlug, normalizeUrlPath } from "./slug";

/** WP 实库真实切片(post_name 为小写 percent-encoded) */
const WP_SLUG = "2-pycharm%e5%ae%89%e8%a3%85%e9%85%8d%e7%bd%ae%e8%bf%87%e7%a8%8b";

describe("normalizeSlug", () => {
  it("解码中文输入 → 小写编码形态(路由 params 主路径)", () => {
    expect(normalizeSlug("2-pycharm安装配置过程")).toBe(WP_SLUG);
  });

  it("已是小写编码形态 → 原样(迁移脚本主路径)", () => {
    expect(normalizeSlug(WP_SLUG)).toBe(WP_SLUG);
  });

  it("十六进制大写形态 → 归一为小写(与 DB 一致);字面字母不动", () => {
    // 仅 %XX 部分大写:DB 口径为小写十六进制,字面大写字母不转(03 文档:不做任何改写)
    const upperHex = WP_SLUG.replace(/%[0-9a-f]{2}/g, (m) => m.toUpperCase());
    expect(normalizeSlug(upperHex)).toBe(WP_SLUG);
    expect(normalizeSlug("2-PyCharm 安装")).toBe("2-PyCharm%20%e5%ae%89%e8%a3%85");
  });

  it("编码↔解码往返一致", () => {
    const cases = ["【工具技巧】PyCharm 安装", "LLaMA-Factory 微调 day24", "hello-world-123"];
    for (const c of cases) {
      expect(normalizeSlug(decodeURIComponent(normalizeSlug(c)))).toBe(normalizeSlug(c));
    }
  });

  it("幂等:重复调用结果不变", () => {
    for (const s of [WP_SLUG, "中文 slug", "plain"]) {
      expect(normalizeSlug(normalizeSlug(s))).toBe(normalizeSlug(s));
    }
  });

  it("裸 % 字面量不抛异常,编码为 %25", () => {
    expect(normalizeSlug("50%off")).toBe("50%25off");
    expect(normalizeSlug("%")).toBe("%25");
  });

  it("空格 → %20;+ 为字面加号 → %2b(小写十六进制,DB 统一口径)", () => {
    expect(normalizeSlug("a b")).toBe("a%20b");
    expect(normalizeSlug("a+b")).toBe("a%2bb");
  });

  it("二次编码输入还原为单层编码", () => {
    expect(normalizeSlug("%25e5%25ae%2589")).toBe("%e5%ae%89");
  });

  it("空串返回空串", () => {
    expect(normalizeSlug("")).toBe("");
  });

  it("数字纯 slug(WP 实库存在,如 post_name='7')原样保留", () => {
    expect(normalizeSlug("7")).toBe("7");
  });
});

describe("normalizeUrlPath", () => {
  const UPLOAD_URL = "/wp-content/uploads/2024/04/%e4%bb%a3%e7%a0%81%e8%87%aa%e5%8a%a8%e8%a1%a5%e5%85%a8.png";

  it("已编码路径原样保留,路径分隔符不编码(媒体路径主路径)", () => {
    expect(normalizeUrlPath(UPLOAD_URL)).toBe(UPLOAD_URL);
  });

  it("解码形态的中文路径 → 编码(与 WP attachments 的 _wp_attached_file 对应)", () => {
    expect(normalizeUrlPath("/wp-content/uploads/2024/04/代码自动补全.png")).toBe(UPLOAD_URL);
  });

  it("幂等;与 normalizeSlug 的差异仅在斜杠保留", () => {
    expect(normalizeUrlPath(normalizeUrlPath(UPLOAD_URL))).toBe(UPLOAD_URL);
    expect(normalizeSlug("/2024/04/图.png")).toBe("%2f2024%2f04%2f%e5%9b%be.png");
  });
});
