/**
 * 文章列表「文章 + 贴图」合并时间流(2026-11-01 列表页重构)。
 *
 * 两源各自稳定有序(publishedAt desc, id desc),合并后统一分页:
 * 先取两边总数 → 定本轮需要的前 need 条 → 各取头部 → 归并 → 按页切片。
 * 只取 pageSize 条会漏项:两源交错的页,第 2 页的条目可能来自任一源的前 20 条。
 *
 * 筛选语义:贴图无分类/标签关联,只进 /articles 总流;分类/标签页仍走
 * listPostsPage(纯文章)。/articles 的 originalOnly 只作用于文章——贴图
 * 皆为站内原创产出,始终计入。
 */
import { prerenderSafe } from "@/lib/prerender-safe";
import {
  countPublishedPinsForFeed,
  listPublishedPinsHead,
  type PinListItem,
} from "@/lib/pins/public-read";

import { countPostsForList, listPostsHead, type PostListItem } from "./posts";

/** 合并流里贴图的轻投影(列表/卡片只需这些字段) */
export interface PinFeedItem {
  id: bigint;
  title: string;
  content: string;
  publishedAt: Date;
  coverPath: string | null;
  imageCount: number;
}

export type FeedItem =
  | { kind: "post"; publishedAt: Date; post: PostListItem }
  | { kind: "pin"; publishedAt: Date; pin: PinFeedItem };

export interface ArticleFeedPage {
  items: FeedItem[];
  /** 合并后总条数(文章 + 贴图),分页口径 */
  total: number;
  postTotal: number;
  pinTotal: number;
  page: number;
  pageSize: number;
}

/** 文章 → 流条目;publishedAt 为空在 where 已挡,这里只做类型收窄 */
export function toPostFeedItem(post: PostListItem): FeedItem | null {
  if (!post.publishedAt) return null;
  return { kind: "post", publishedAt: post.publishedAt, post };
}

export function toPinFeedItem(pin: PinListItem): PinFeedItem {
  return {
    id: pin.id,
    title: pin.title,
    content: pin.content,
    publishedAt: pin.publishedAt,
    coverPath: pin.coverPath,
    imageCount: pin.imageCount,
  };
}

/** BigInt 降序比较(禁混用 `<` / `-`:大数相减会丢精度且类型报错) */
function compareIdDesc(a: bigint, b: bigint): number {
  return a > b ? -1 : a < b ? 1 : 0;
}

function compareFeed(a: FeedItem, b: FeedItem): number {
  const byTime = b.publishedAt.getTime() - a.publishedAt.getTime();
  if (byTime !== 0) return byTime;
  // 同刻稳定序:文章在前,贴图在后;同类型按 id 降序(与各自列表的 tiebreaker 一致)
  if (a.kind !== b.kind) return a.kind === "post" ? -1 : 1;
  const aId = a.kind === "post" ? a.post.id : a.pin.id;
  const bId = b.kind === "post" ? b.post.id : b.pin.id;
  return compareIdDesc(aId, bId);
}

/**
 * 纯函数归并 + 分页切片(posts/pins 须各自按时间序给出头部数据)。
 * 单测直接打这里,不依赖 DB。
 */
export function mergeFeedPostsAndPins(
  posts: PostListItem[],
  pins: PinFeedItem[],
  page: number,
  pageSize: number,
): FeedItem[] {
  const merged: FeedItem[] = [];
  for (const post of posts) {
    const item = toPostFeedItem(post);
    if (item) merged.push(item);
  }
  for (const pin of pins) merged.push({ kind: "pin", publishedAt: pin.publishedAt, pin });
  merged.sort(compareFeed);
  const offset = (page - 1) * pageSize;
  return merged.slice(offset, offset + pageSize);
}

/** /articles 合并流取数(ISR;构建期无库降级空列表,同列表族口径) */
export async function listArticleFeed({
  page,
  pageSize,
}: {
  page: number;
  pageSize: number;
}): Promise<ArticleFeedPage> {
  const safePage = Math.max(1, page);
  const fallback: ArticleFeedPage = {
    items: [],
    total: 0,
    postTotal: 0,
    pinTotal: 0,
    page: safePage,
    pageSize,
  };
  return prerenderSafe("articles.feed", fallback, async () => {
    const [postTotal, pinTotal] = await Promise.all([
      countPostsForList({ originalOnly: true }),
      countPublishedPinsForFeed(),
    ]);
    const total = postTotal + pinTotal;
    const offset = (safePage - 1) * pageSize;
    if (offset >= total) return { ...fallback, total, postTotal, pinTotal };
    const need = Math.min(safePage * pageSize, total);
    const [posts, pins] = await Promise.all([
      listPostsHead({ limit: need, originalOnly: true }),
      listPublishedPinsHead(need),
    ]);
    return {
      items: mergeFeedPostsAndPins(posts, pins.map(toPinFeedItem), safePage, pageSize),
      total,
      postTotal,
      pinTotal,
      page: safePage,
      pageSize,
    };
  });
}
