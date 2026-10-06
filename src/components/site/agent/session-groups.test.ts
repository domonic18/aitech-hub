/**
 * session-groups 单测:今/昨/更早分组边界(当日 0 点/昨日 0 点恰好归上组)、
 * 保序、空列表;now 注入消时间敏感。
 */
import { describe, expect, it } from "vitest";

import type { AgentSessionItem } from "./AgentSidebar";
import { groupSessions } from "./session-groups";

function item(id: string, lastMessageAt: string): AgentSessionItem {
  return { id, title: id, createdAt: lastMessageAt, lastMessageAt };
}

// 固定「now」:2026-10-07 15:00 本地时区
const NOW = new Date(2026, 9, 7, 15, 0, 0);

describe("groupSessions", () => {
  it("今天/昨天/更早各归其位,保序不重排", () => {
    const sessions = [
      item("e2", "2026-09-20T08:00:00"),
      item("t1", "2026-10-07T09:00:00"),
      item("y1", "2026-10-06T23:59:59"),
      item("t2", "2026-10-07T14:59:00"),
      item("e1", "2026-10-01T00:00:00"),
    ];
    const g = groupSessions(sessions, NOW);
    expect(g.today.map((s) => s.id)).toEqual(["t1", "t2"]);
    expect(g.yesterday.map((s) => s.id)).toEqual(["y1"]);
    expect(g.earlier.map((s) => s.id)).toEqual(["e2", "e1"]);
  });

  it("边界:当日 0 点归今天,昨日 0 点归昨天", () => {
    const g = groupSessions(
      [item("t0", "2026-10-07T00:00:00"), item("y0", "2026-10-06T00:00:00")],
      NOW,
    );
    expect(g.today.map((s) => s.id)).toEqual(["t0"]);
    expect(g.yesterday.map((s) => s.id)).toEqual(["y0"]);
  });

  it("空列表 → 三组皆空", () => {
    expect(groupSessions([], NOW)).toEqual({ today: [], yesterday: [], earlier: [] });
  });
});
