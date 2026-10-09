import { describe, expect, it } from "vitest";

import {
  canonicalUrl,
  contentHash,
  decodeHtmlEntities,
  looksGarbled,
  stripHtml,
  truncateSummary,
} from "./normalize";

describe("canonicalUrl", () => {
  it("去 tracking 参数与尾斜杠,host 小写", () => {
    expect(canonicalUrl("https://WWW.Example.com/a/b/?utm_source=x&id=3")).toBe(
      "https://www.example.com/a/b?id=3",
    );
  });

  it("根路径保留斜杠,保留 hash", () => {
    expect(canonicalUrl("https://a.com/#top")).toBe("https://a.com/#top");
  });

  it("非法 URL 原样返回(不抛)", () => {
    expect(canonicalUrl("not a url")).toBe("not a url");
  });
});

describe("contentHash", () => {
  it("40 位 hex,标题大小写不敏感,utm 不影响", () => {
    const h1 = contentHash("Hello AI", "https://a.com/x?utm_source=t");
    const h2 = contentHash("hello ai", "https://A.com/x/");
    expect(h1).toMatch(/^[0-9a-f]{40}$/);
    expect(h1).toBe(h2);
  });

  it("不同 URL 哈希不同", () => {
    expect(contentHash("t", "https://a.com/1")).not.toBe(contentHash("t", "https://a.com/2"));
  });
});

describe("stripHtml / truncateSummary", () => {
  it("剥标签解码实体折叠空白", () => {
    expect(stripHtml("<p>A&nbsp;&amp;&nbsp;<b>B</b></p>")).toBe("A & B");
  });

  it("短文本原样,句末标点优先断句", () => {
    expect(truncateSummary("短文")).toBe("短文");
    const long = "第一句。第二句。" + "补".repeat(200);
    expect(truncateSummary(long, 20)).toBe("第一句。第二句。");
  });

  it("无标点硬切加省略号", () => {
    const r = truncateSummary("啊".repeat(50), 10);
    expect(r).toBe("啊".repeat(9) + "…");
  });
});

describe("looksGarbled", () => {
  it("正常中文/含换行不为乱码", () => {
    expect(looksGarbled("正常文本\n第二行")).toBe(false);
  });

  it("替换符超 5% 判乱码", () => {
    expect(looksGarbled("�".repeat(10) + "ab")).toBe(true);
  });
});

describe("decodeHtmlEntities(2026-10-09 验收反馈问题3)", () => {
  it("数字实体解码(TechCrunch 双重转义残留形态)", () => {
    expect(decodeHtmlEntities("Pretend you&#8217;re sitting")).toBe("Pretend you’re sitting");
    expect(decodeHtmlEntities("A &amp;#8217; B")).toBe("A ’ B"); // 二次编码递进落到意图字符
    expect(decodeHtmlEntities("Tom &amp; Jerry")).toBe("Tom & Jerry"); // 合法 & 文本不受影响
  });

  it("十六进制与命名实体;非法越界码点原样保留", () => {
    expect(decodeHtmlEntities("&#x4e2d;&#x6587;")).toBe("中文");
    expect(decodeHtmlEntities("A &amp; B &lt;tag&gt; &quot;q&quot;&nbsp;")).toBe(
      'A & B <tag> "q" ',
    );
    expect(decodeHtmlEntities("bad &#999999999999; ent")).toBe("bad &#999999999999; ent");
  });

  it("无 & 快路径原样返回", () => {
    expect(decodeHtmlEntities("纯中文标题")).toBe("纯中文标题");
  });
});
