/** admin crumb 链单测(2026-10-30 验收:点「机会与痛点」落 /admin/insight/clusters/ 404) */
import { describe, expect, it } from "vitest";

import { crumbsOf } from "./admin-crumbs";

describe("crumbsOf", () => {
  it("虚拟段 clusters 指向真实落点,不拼字面路径", () => {
    expect(crumbsOf("/admin/insight/clusters/123")).toEqual([
      { label: "站点统计", href: "/admin" },
      { label: "洞察中心", href: "/admin/insight" },
      { label: "机会与痛点", href: "/admin/insight/" },
      { label: "簇详情" },
    ]);
  });

  it("普通段仍按累计路径可点击,末级无 href", () => {
    expect(crumbsOf("/admin/data/run/")).toEqual([
      { label: "站点统计", href: "/admin" },
      { label: "数据中心", href: "/admin/data" },
      { label: "运行" },
    ]);
  });

  it("根路径只有首级", () => {
    expect(crumbsOf("/admin")).toEqual([{ label: "站点统计", href: "/admin" }]);
  });
});
