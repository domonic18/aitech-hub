/**
 * 计划条呈现态单测(2026-11-17 中断可见性):run 被腰斩时未完成项标
 * 「⊘ 已中断」、已完成项仍为 ✓,并给「已完成 N / 未完成 M」汇总——
 * 用户能看见做到哪一步,而不是一排 pending。
 */
import { describe, expect, it } from "vitest";

import {
  TODO_MARKERS,
  TODO_MARKER_INTERRUPTED,
  todoMarker,
  todoSummary,
  toTodoViews,
  type AgentTodo,
} from "./todos";

const TODOS: AgentTodo[] = [
  { content: "检索站内相关内容", status: "completed" },
  { content: "展开文章正文", status: "in_progress" },
  { content: "归纳对比结论", status: "pending" },
];

describe("计划条呈现态", () => {
  it("正常态:三态标记各归其位,无中断标记", () => {
    const views = toTodoViews(TODOS, false);
    expect(views.map(todoMarker)).toEqual([
      TODO_MARKERS.completed,
      TODO_MARKERS.in_progress,
      TODO_MARKERS.pending,
    ]);
    expect(views.every((v) => v.interrupted === false)).toBe(true);
    expect(todoSummary(TODOS, false)).toBeNull();
  });

  it("中断态:未完成项标「⊘ 已中断」,已完成项仍是 ✓", () => {
    const views = toTodoViews(TODOS, true);
    expect(todoMarker(views[0])).toBe(TODO_MARKERS.completed);
    expect(todoMarker(views[1])).toBe(TODO_MARKER_INTERRUPTED);
    expect(todoMarker(views[2])).toBe(TODO_MARKER_INTERRUPTED);
    expect(views[0].interrupted).toBe(false);
    expect(views[1].interrupted).toBe(true);
  });

  it("中断态:给「已完成 N 项 / 未完成 M 项」汇总", () => {
    expect(todoSummary(TODOS, true)).toBe("本次运行中断,1 项已完成 / 2 项未完成");
  });

  it("空计划无汇总", () => {
    expect(todoSummary([], true)).toBeNull();
  });
});
