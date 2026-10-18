/**
 * 关键词云图(M34 批③ 渠道视图):近 7 日活跃、已打标簇的关键词按簇机会分
 * 加权,字号 12-28px 线性映射;同词多簇取最高分,点词跳簇详情看信号原话。
 * 纯展示零状态,数据来自 lib/insight/hotboard#insightKeywordCloud。
 */
import type { InsightCloudWord } from "@/lib/insight/hotboard";

const FONT_MIN = 12;
const FONT_MAX = 28;

function tierClass(t: number): string {
  if (t >= 0.66) return "font-semibold text-accent";
  if (t >= 0.33) return "text-text-1";
  return "text-text-2";
}

export default function KeywordCloud({ words }: { words: InsightCloudWord[] }): React.ReactElement {
  if (words.length === 0) {
    return (
      <div className="rounded-md border border-line bg-panel px-4 py-6 text-center text-xs text-text-3">
        暂无关键词:簇打标需在 /admin/models 绑定「洞察归纳」模型,日批(03:57)跑完即生成
      </div>
    );
  }
  const min = Math.min(...words.map((w) => w.weight));
  const max = Math.max(...words.map((w) => w.weight));
  const span = Math.max(max - min, 1);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-line bg-panel px-4 py-4">
      {words.map((w) => {
        const t = (w.weight - min) / span;
        return (
          <a
            key={w.word}
            href={`/admin/insight/clusters/${w.clusterId}`}
            title={`${w.label} · 机会分 ${w.weight}`}
            style={{ fontSize: `${FONT_MIN + Math.round(t * (FONT_MAX - FONT_MIN))}px` }}
            className={`leading-snug hover:text-accent ${tierClass(t)}`}
          >
            {w.word}
          </a>
        );
      })}
    </div>
  );
}
