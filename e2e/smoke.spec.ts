import { expect, test } from "@playwright/test";

/**
 * E2E 冒烟(standard/01-testing §4):首页/中文 slug 文章/legacy 301/登录(M4)/SEO 端点。
 * 映射样例取自 legacy_url_map 真实行(迁移产物,与库内数据耦合是验收本意)。
 */
const LEGACY_TO_ARTICLES =
  "/%e9%a6%96%e4%b8%aagpu%e9%ab%98%e7%ba%a7%e8%af%ad%e8%a8%80%ef%bc%8c%e5%a4%a7%e8%a7%84%e6%a8%a1%e5%b9%b6%e8%a1%8c%e5%b0%b1%e5%83%8f%e5%86%99python%ef%bc%8c%e5%b7%b2%e8%8e%b78500-star/";
const LEGACY_TO_HOME = "/ai%e8%a7%86%e9%a2%91%e5%b7%a5%e5%85%b7/";

/** 单段文章路径:排除静态路由与文件形态(/sitemap.xml、/category/… 天然多段不在此列) */
const STATIC_SEGMENTS = new Set([
  "articles",
  "archive",
  "about",
  "agreement",
  "privacy",
  "search",
  "category",
  "tag",
]);
function isPostPath(pathname: string): boolean {
  const segs = pathname.split("/").filter(Boolean);
  return segs.length === 1 && !segs[0].includes(".") && !STATIC_SEGMENTS.has(segs[0]);
}

async function sitemapPostUrls(
  request: import("@playwright/test").APIRequestContext,
): Promise<string[]> {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  return locs.map((u) => new URL(u).pathname).filter(isPostPath);
}

test("1. 首页 200 且含最新文章卡", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('href="/articles/"');
  const cardSlugs = [...html.matchAll(/href="\/([^"/]+)\/"/g)]
    .map((m) => m[1])
    .filter(
      (s) =>
        ![
          "articles",
          "archive",
          "about",
          "agreement",
          "privacy",
          "search",
          "category",
          "tag",
        ].includes(s),
    );
  expect(cardSlugs.length).toBeGreaterThan(0);
});

test("2. 中文编码 slug 直开文章:200、标题、图片无 broken", async ({ request, browser }) => {
  const posts = await sitemapPostUrls(request);
  expect(posts.length).toBeGreaterThan(150);
  // arch/07-frontend §2 规则 5:中文 URL 直开采样 10 篇
  for (const path of posts.slice(0, 10)) {
    expect((await request.get(path)).status()).toBe(200);
  }

  // 图片 naturalWidth 抽查:从采样里找第一篇正文带图的(部分文章可能无图)
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const path of posts.slice(0, 10)) {
    await page.goto(path, { waitUntil: "load" });
    expect(await page.locator("h1").innerText()).not.toBe("");
    const imgs = page.locator("article img");
    if ((await imgs.count()) > 0) {
      const widths = await imgs.evaluateAll((els) =>
        els.map((el) => (el as HTMLImageElement).naturalWidth),
      );
      expect(widths.some((w) => w > 0)).toBe(true);
      break;
    }
  }
  await context.close();
});

test("3. 弃用 slug:route 精确 301;单段直开永久重定向", async ({ request }) => {
  // /legacy/<path> 路由层:表内 http_status=301 原样表达
  const viaRoute = await request.get(`/legacy${LEGACY_TO_ARTICLES}`, { maxRedirects: 0 });
  expect(viaRoute.status()).toBe(301);
  expect(viaRoute.headers().location).toMatch(/\/articles$/);

  // 单段直开落 [slug] 页兜底:permanentRedirect(308,永久类);精确 301 由 route 层表达(arch/07-frontend §6)
  const direct = await request.get(LEGACY_TO_ARTICLES, { maxRedirects: 0 });
  expect([301, 307, 308]).toContain(direct.status());
  expect(direct.headers().location).toMatch(/\/articles$/);

  const toHome = await request.get(`/legacy${LEGACY_TO_HOME}`, { maxRedirects: 0 });
  expect(toHome.status()).toBe(301);
  expect(new URL(toHome.headers().location!, "http://localhost:3000").pathname).toBe("/");

  expect((await request.get("/legacy/no/such/path/", { maxRedirects: 0 })).status()).toBe(404);
});

test("4. 登录流(依赖 M4 短信登录)", async () => {
  test.skip(true, "M4 实现后补:集成环境注入 SMS_E2E_BYPASS_CODE(standard/01-testing §4)");
});

test("5. SEO/GEO 端点:sitemap、feed、robots、llms.txt、文章 .md 直出", async ({ request }) => {
  const feed = await request.get("/feed.xml");
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("application/rss+xml");
  expect((await feed.text()).match(/<item>/g)?.length).toBeGreaterThan(0);

  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Sitemap:");

  const llms = await request.get("/llms.txt");
  expect(llms.status()).toBe(200);
  expect(await llms.text()).toContain("## 文章");

  const post = (await sitemapPostUrls(request))[0];
  const md = await request.get(`${post.replace(/\/$/, "")}.md`);
  expect(md.status()).toBe(200);
  expect(md.headers()["content-type"]).toContain("text/markdown");
  expect((await md.text()).length).toBeGreaterThan(100);
});
