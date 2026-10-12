/**
 * B站搜索结果聚合(M25 任务B,纯函数零 IO):
 * 按 mid 聚博主(跨词命中去重、maxPlay、前 5 标题样本)、按 bvid 聚视频。
 * 排序稳定性:hitCount desc → 播放 desc → 标识序,轮次间可比。
 */
import type { SearchItem } from "./bili/contract";

/** 单词搜索结果(items 已由 contract 层解析并清洗高亮标签) */
export interface WordResult {
  word: string;
  items: SearchItem[];
}

export interface BloggerAgg {
  mid: string;
  author: string;
  /** 命中的去重词表(与 hitCount 一致) */
  hitKeywords: string[];
  hitCount: number;
  /** 命中视频里的最高播放(博主量级代理指标) */
  maxPlay: number;
  /** 前 5 条标题样本(L0 与人工终审依据) */
  sampleTitles: string[];
}

export interface VideoAgg {
  bvid: string;
  author: string;
  title: string;
  hitKeywords: string[];
  hitCount: number;
  play: number;
}

/** 博主标题样本条数上限(与 discovery_candidate.sample_titles 口径一致) */
const SAMPLE_TITLES_LIMIT = 5;

export function aggregateBloggers(results: readonly WordResult[]): BloggerAgg[] {
  const byMid = new Map<string, BloggerAgg>();
  for (const { word, items } of results) {
    for (const item of items) {
      const mid = String(item.mid);
      let agg = byMid.get(mid);
      if (!agg) {
        agg = {
          mid,
          author: item.author,
          hitKeywords: [],
          hitCount: 0,
          maxPlay: 0,
          sampleTitles: [],
        };
        byMid.set(mid, agg);
      }
      if (item.author) agg.author = item.author;
      if (!agg.hitKeywords.includes(word)) agg.hitKeywords.push(word);
      agg.hitCount = agg.hitKeywords.length;
      if (item.play > agg.maxPlay) agg.maxPlay = item.play;
      if (agg.sampleTitles.length < SAMPLE_TITLES_LIMIT && !agg.sampleTitles.includes(item.title)) {
        agg.sampleTitles.push(item.title);
      }
    }
  }
  return [...byMid.values()].sort(
    (a, b) => b.hitCount - a.hitCount || b.maxPlay - a.maxPlay || a.mid.localeCompare(b.mid),
  );
}

export function aggregateVideos(results: readonly WordResult[]): VideoAgg[] {
  const byBvid = new Map<string, VideoAgg>();
  for (const { word, items } of results) {
    for (const item of items) {
      let agg = byBvid.get(item.bvid);
      if (!agg) {
        agg = {
          bvid: item.bvid,
          author: item.author,
          title: item.title,
          hitKeywords: [],
          hitCount: 0,
          play: item.play,
        };
        byBvid.set(item.bvid, agg);
      }
      if (!agg.hitKeywords.includes(word)) agg.hitKeywords.push(word);
      agg.hitCount = agg.hitKeywords.length;
      if (item.play > agg.play) agg.play = item.play;
    }
  }
  return [...byBvid.values()].sort(
    (a, b) => b.hitCount - a.hitCount || b.play - a.play || a.bvid.localeCompare(b.bvid),
  );
}
