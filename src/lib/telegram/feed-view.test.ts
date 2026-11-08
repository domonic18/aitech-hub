/**
 * 电报流分页纯函数单测(M69「加载更多」):游标只推进实收条数并夹到上限;
 * 「还有更多」= 满页且未触上限(短页即到底,防无限点击)。
 */
import { describe, expect, it } from "vitest";

import { FEED_MAX_OFFSET, FEED_PAGE_SIZE, feedHasMore, nextFeedCursor } from "./feed-view";

describe("nextFeedCursor", () => {
  it("按本页实收条数推进", () => {
    expect(nextFeedCursor(0, FEED_PAGE_SIZE)).toBe(30);
    expect(nextFeedCursor(60, 30)).toBe(90);
  });

  it("触上限即夹住(不越界请求)", () => {
    expect(nextFeedCursor(480, 30)).toBe(FEED_MAX_OFFSET);
    expect(nextFeedCursor(490, 30)).toBe(FEED_MAX_OFFSET);
    expect(nextFeedCursor(FEED_MAX_OFFSET, 30)).toBe(FEED_MAX_OFFSET);
  });
});

describe("feedHasMore", () => {
  it("满页且未触上限 → 还有下一页", () => {
    expect(feedHasMore(FEED_PAGE_SIZE, 30)).toBe(true);
    expect(feedHasMore(FEED_PAGE_SIZE, 470)).toBe(true);
  });

  it("短页/空页/触上限 → 到底", () => {
    expect(feedHasMore(FEED_PAGE_SIZE - 1, 29)).toBe(false);
    expect(feedHasMore(0, 0)).toBe(false);
    expect(feedHasMore(FEED_PAGE_SIZE, FEED_MAX_OFFSET)).toBe(false);
  });
});
