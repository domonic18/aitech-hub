/**
 * 合并流纯函数单测(2026-11-01 列表页重构):排序、tiebreak、分页切片连续性。
 * 这里守的是「两源各自有序 → 合并页不重不漏」——分页错位是用户可见缺陷,
 * 且不会被类型检查发现。
 */
import { describe, expect, it } from "vitest";

import type { PostListItem } from "./posts";
import {
  mergeFeedPostsAndPins,
  toPinFeedItem,
  type FeedItem,
  type PinFeedItem,
} from "./article-feed";

function post(id: number, day: number, hour = 0): PostListItem {
  const at = new Date(Date.UTC(2026, 9, day, hour));
  return {
    id: BigInt(id),
    slug: `post-${id}`,
    title: `文章 ${id}`,
    excerpt: null,
    coverPath: null,
    viewsCount: 0,
    isPinned: false,
    isPurchasable: false,
    publishedAt: at,
    updatedAt: at,
    seoDescription: null,
    category: { slug: "blog", name: "博客文章" },
    tags: [],
    commentCount: 0,
    likeCount: 0,
  } as unknown as PostListItem;
}

function pin(id: number, day: number, hour = 0): PinFeedItem {
  return {
    id: BigInt(id),
    title: `贴图 ${id}`,
    content: "贴图文案",
    publishedAt: new Date(Date.UTC(2026, 9, day, hour)),
    coverPath: `/wp-content/uploads/pin-${id}.webp`,
    imageCount: 2,
  };
}

function keyOf(item: FeedItem): string {
  return item.kind === "post" ? `post-${item.post.id}` : `pin-${item.pin.id}`;
}

describe("mergeFeedPostsAndPins", () => {
  it("按 publishedAt 降序混排两源", () => {
    const items = mergeFeedPostsAndPins([post(1, 3), post(2, 1)], [pin(11, 2)], 1, 10);
    expect(items.map((i) => (i.kind === "post" ? `post-${i.post.id}` : `pin-${i.pin.id}`))).toEqual(
      ["post-1", "pin-11", "post-2"],
    );
  });

  it("同刻:文章在前、贴图在后;同类型按 id 降序", () => {
    const items = mergeFeedPostsAndPins([post(1, 5), post(2, 5)], [pin(9, 5), pin(8, 5)], 1, 10);
    expect(items.map((i) => (i.kind === "post" ? `post-${i.post.id}` : `pin-${i.pin.id}`))).toEqual(
      ["post-2", "post-1", "pin-9", "pin-8"],
    );
  });

  it("按页切片与整体有序序列一致(不重不漏)", () => {
    const posts = Array.from({ length: 7 }, (_, i) => post(i + 1, 20 - i));
    const pins = Array.from({ length: 6 }, (_, i) => pin(100 + i, 19 - i));
    const all = mergeFeedPostsAndPins(posts, pins, 1, 20);
    const paged = [
      ...mergeFeedPostsAndPins(posts, pins, 1, 3),
      ...mergeFeedPostsAndPins(posts, pins, 2, 3),
      ...mergeFeedPostsAndPins(posts, pins, 3, 3),
      ...mergeFeedPostsAndPins(posts, pins, 4, 3),
      ...mergeFeedPostsAndPins(posts, pins, 5, 3),
    ];
    expect(paged.map(keyOf)).toEqual(all.map(keyOf));
    expect(new Set(paged.map(keyOf)).size).toBe(all.length);
  });

  it("publishedAt 为 null 的文章被剔除(where 已挡,防御兜底)", () => {
    const nullPost = { ...post(1, 3), publishedAt: null } as unknown as PostListItem;
    const items = mergeFeedPostsAndPins([nullPost, post(2, 2)], [pin(9, 1)], 1, 10);
    expect(items.map(keyOf)).toEqual(["post-2", "pin-9"]);
  });

  it("越界页返回空数组", () => {
    expect(mergeFeedPostsAndPins([post(1, 3)], [pin(9, 2)], 5, 10)).toEqual([]);
  });

  it("BigInt id 比较不抛类型错误(大数)", () => {
    const huge = BigInt("9007199254740993");
    const a = { ...post(1, 3), id: huge } as PostListItem;
    const b = { ...post(2, 3), id: huge + BigInt(2) } as PostListItem;
    const items = mergeFeedPostsAndPins([a, b], [], 1, 10);
    const first = items[0];
    expect(first?.kind === "post" ? first.post.id : null).toBe(huge + BigInt(2));
  });
});

describe("toPinFeedItem", () => {
  it("只保留流需要的字段", () => {
    const item = toPinFeedItem({
      id: BigInt(7),
      title: "标题",
      content: "文案",
      publishedAt: new Date(Date.UTC(2026, 9, 1)),
      coverPath: "/wp-content/uploads/a.webp",
      coverWidth: 1080,
      coverHeight: 1920,
      imageCount: 4,
    });
    expect(item).toEqual({
      id: BigInt(7),
      title: "标题",
      content: "文案",
      publishedAt: new Date(Date.UTC(2026, 9, 1)),
      coverPath: "/wp-content/uploads/a.webp",
      imageCount: 4,
    });
  });
});
