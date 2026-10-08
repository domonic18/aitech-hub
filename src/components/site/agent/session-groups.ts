/**
 * 会话列表今/昨/更早分组(K2.5;平移 ai-invest 分组逻辑,Date 原生不引
 * dayjs)。listSessions 已按 lastMessageAt 倒序,分组保序不重排。
 */
import type { AgentSessionItem } from "./AgentSidebar";

export interface GroupedSessions {
  today: AgentSessionItem[];
  yesterday: AgentSessionItem[];
  earlier: AgentSessionItem[];
}

/** 今/昨/更早分组(now 可注入供测试;边界值恰好 0 点归「今天」) */
export function groupSessions(
  sessions: AgentSessionItem[],
  now: Date = new Date(),
): GroupedSessions {
  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - 24 * 3600_000;
  const grouped: GroupedSessions = { today: [], yesterday: [], earlier: [] };
  for (const s of sessions) {
    const t = new Date(s.lastMessageAt).getTime();
    if (t >= todayStart) grouped.today.push(s);
    else if (t >= yesterdayStart) grouped.yesterday.push(s);
    else grouped.earlier.push(s);
  }
  return grouped;
}
