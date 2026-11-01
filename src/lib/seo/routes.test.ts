/**
 * SEO 路由清单防漂移:清单里每一条都必须有真实源文件。
 * 路由改名而清单没跟,后果是内部全站失效静默漏掉一个缓存面(不报错、不告警),
 * 只能靠人去发现某个出口永远是旧的 —— 故用测试顶住。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SEO_ROUTE_SOURCES, SEO_ROUTES, WARM_ROUTES } from "./routes";

describe("SEO 路由清单", () => {
  it("清单与源文件映射一一对应", () => {
    expect(Object.keys(SEO_ROUTE_SOURCES).sort()).toEqual([...SEO_ROUTES].sort());
  });

  it.each(SEO_ROUTES)("%s 的源文件存在", (route) => {
    expect(existsSync(join(process.cwd(), SEO_ROUTE_SOURCES[route]))).toBe(true);
  });
});

describe("启动预热清单(warm-routes.json)", () => {
  it("SEO 出口全部在预热清单内(预热漏掉一个出口 = 起服后仍是空壳)", () => {
    expect(WARM_ROUTES).toEqual(expect.arrayContaining([...SEO_ROUTES]));
  });

  it("页面路由带尾斜杠(next trailingSlash: true,无斜杠形态会被 308 二次跳转)", () => {
    const seo = SEO_ROUTES as readonly string[];
    const pageRoutes = WARM_ROUTES.filter((route) => !seo.includes(route));
    expect(pageRoutes.length).toBeGreaterThan(0);
    for (const route of pageRoutes) expect(route.endsWith("/")).toBe(true);
  });
});
