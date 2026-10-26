/**
 * 评论屏蔽词过滤单测(M23 批①):scope 生效域、大小写不敏感、空词跳过。
 * 先发后审模式下这是唯一自动闸,语义从严从窄(scope=comment/all 才生效)。
 */
import { describe, expect, it } from "vitest";

import { matchCommentBlocklist } from "./comment-filter";

const words = [
  { word: "刷单", scope: "comment" as const },
  { word: "VX", scope: "comment" as const },
  { word: "标题党", scope: "title" as const },
  { word: "广告", scope: "all" as const },
];

describe("matchCommentBlocklist", () => {
  it("scope=comment 命中;scope=title 不作用于评论", () => {
    expect(matchCommentBlocklist("帮忙刷单的加我", words)).toEqual({
      rule: "blocklist:刷单",
      word: "刷单",
    });
    expect(matchCommentBlocklist("这文章标题党了吧", words)).toBeNull();
  });

  it("scope=all 双域生效", () => {
    expect(matchCommentBlocklist("纯广告内容", words)).toEqual({
      rule: "blocklist:广告",
      word: "广告",
    });
  });

  it("大小写不敏感(lower() 比对,勿依赖 collation)", () => {
    expect(matchCommentBlocklist("加我 vx 详聊", words)).toEqual({
      rule: "blocklist:VX",
      word: "VX",
    });
    expect(matchCommentBlocklist("加我 VX 详聊", words)?.word).toBe("VX");
  });

  it("干净内容返回 null;空词跳过", () => {
    expect(matchCommentBlocklist("写得不错,学到了", words)).toBeNull();
    expect(matchCommentBlocklist("任意内容", [{ word: "", scope: "comment" }])).toBeNull();
  });
});
