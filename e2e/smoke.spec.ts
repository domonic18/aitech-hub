import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

/**
 * E2E 冒烟(standard/01-testing §4):首页/中文 slug 文章/legacy 301/admin 登录(M4)/
 * SEO 端点/后台发布→前台闭环(M5-a)。
 * 映射样例取自 legacy_url_map 真实行(迁移产物,与库内数据耦合是验收本意)。
 */

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

/** e2e 专用 admin 账号(本地库幂等 upsert;与开发者个人账号隔离) */
const E2E_ADMIN_PHONE = "13800000000";
const E2E_ADMIN_PASSWORD = "e2e-admin-pass1";

test.afterAll(async () => {
  await prisma.$disconnect();
});
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
    .filter((s) => !STATIC_SEGMENTS.has(s));
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

test("4. admin 登录流(M4:守卫预检/密码登录/爆破提示/会话吊销)", async ({ page }) => {
  const passwordHash = await bcrypt.hash(E2E_ADMIN_PASSWORD, 10);
  await prisma.userAccount.upsert({
    where: { phone: E2E_ADMIN_PHONE },
    update: { role: "admin", status: "active", passwordHash },
    create: {
      phone: E2E_ADMIN_PHONE,
      nickname: "e2e-admin",
      role: "admin",
      status: "active",
      passwordHash,
    },
  });

  // 4.1 未登录访问 /admin → middleware 预检跳登录页(trailingSlash:true,路径带尾斜杠)
  await page.goto("/admin");
  expect(new URL(page.url()).pathname).toMatch(/^\/admin\/login\/?$/);

  // 4.2 错误密码 → 模糊提示(不区分账号锁定/密码错)
  await page.getByPlaceholder("11 位手机号").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill("wrong-pass-9");
  await page.getByRole("button", { name: "登录控制台" }).click();
  await expect(page.getByText("手机号或密码不正确")).toBeVisible();

  // 4.3 正确密码 → 回跳 /admin(登录成功同时清空失败计数)
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);
  await expect(page.getByText("站点统计").first()).toBeVisible();

  // 4.4 会话吊销:UI 登出后把旧 Cookie 复放回去,/admin 仍拒——
  //     middleware 只查 exp 会放行,guard 的 Redis jti 双查兜底(防"签发后即吊销"窗口)
  const oldCookie = (await page.context().cookies()).find((c) => c.name === "ah_at");
  expect(oldCookie).toBeTruthy();

  await page.getByRole("button", { name: "e2e-admin" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await page.waitForURL(/\/admin\/login\/?$/);

  await page
    .context()
    .addCookies([{ name: "ah_at", value: oldCookie!.value, domain: "localhost", path: "/" }]);
  await page.goto("/admin");
  expect(new URL(page.url()).pathname).toMatch(/^\/admin\/login\/?$/);
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

test("6. 后台发布 → 前台闭环(M5a:新建/存草稿/发布/on-demand revalidate/软删)", async ({
  page,
  request,
}) => {
  const TITLE = "E2E 冒烟 M5a 发布闭环";
  // 与库内残留隔离(重跑幂等;slug 由标题派生,同名硬删后派生结果一致)
  await prisma.post.deleteMany({ where: { title: TITLE } });

  // 登录(同用例 4 的 UI 流)
  await page.goto("/admin/login");
  await page.getByPlaceholder("11 位手机号").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);

  // 列表页 → 新建文章 → 填标题与正文 → 存草稿(地址切为编辑态)
  await page.goto("/admin/posts/");
  const newLink = page.getByRole("link", { name: "新建文章" });
  await expect(newLink).toBeVisible();
  await newLink.click();
  await page.waitForURL(/\/admin\/posts\/new\/?$/);
  await page.getByPlaceholder("文章标题…").fill(TITLE);
  await page.getByPlaceholder(/正文\(Markdown/).fill("## E2E 正文\n\nM5a 发布闭环冒烟。");
  await page.getByRole("button", { name: "存草稿" }).click();
  await page.waitForURL(/\/admin\/posts\/\d+\/?$/);

  // 发布 → 全页刷新后出现「下架」(展示态已发布)
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.getByRole("button", { name: "下架" }).waitFor({ timeout: 10_000 });

  const post = await prisma.post.findFirst({
    where: { title: TITLE },
    select: { id: true, slug: true },
  });
  expect(post).toBeTruthy();

  // 前台闭环:/articles/ 出现标题;详情直开 200 且 h1 匹配(发布即 revalidate,不等 ISR)
  expect(await (await request.get("/articles/")).text()).toContain(TITLE);
  const detail = await page.goto(`/${post!.slug}/`);
  expect(detail!.status()).toBe(200);
  await expect(page.locator("h1")).toHaveText(TITLE);

  // 软删:列表行内操作(原生 confirm)→ 行消失 → 前台 404
  await page.goto("/admin/posts/");
  const row = page.getByRole("row", { name: new RegExp(TITLE) });
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "删除" }).click();
  await expect(row).toBeHidden({ timeout: 10_000 });
  expect(
    (await prisma.post.findUnique({ where: { id: post!.id }, select: { status: true } }))?.status,
  ).toBe("deleted");
  expect((await request.get(`/${post!.slug}/`)).status()).toBe(404);

  // 清理本用例数据
  await prisma.post.deleteMany({ where: { title: TITLE } });
});

test("7. 媒体库闭环(M5b:上传/卡片/详情抽屉/软删)", async ({ page }) => {
  const NAME = "e2e-media.png";
  await prisma.media.deleteMany({ where: { filename: NAME } });

  await page.goto("/admin/login");
  await page.getByPlaceholder("11 位手机号").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);

  // 统计卡与工具条
  await page.goto("/admin/media/");
  await expect(page.getByText("近 30 天 / 未引用")).toBeVisible();

  // 上传(setInputFiles 直喂缓冲,无需夹具文件)→ refresh 后卡片出现
  const png = await sharp({
    create: { width: 4, height: 3, channels: 3, background: { r: 30, g: 144, b: 255 } },
  })
    .png()
    .toBuffer();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: NAME, mimeType: "image/png", buffer: png });
  const card = page.locator(`img[alt="${NAME}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });

  // 详情抽屉:预览 + kv + 引用方为空
  await card.click();
  await expect(page.getByRole("heading", { name: "媒体详情" })).toBeVisible();
  await expect(page.getByText("暂无文章引用")).toBeVisible();

  // 软删(原生 confirm)→ 抽屉关、卡片消失,落库 deleted
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除" }).click();
  await expect(page.getByRole("heading", { name: "媒体详情" })).toBeHidden({ timeout: 10_000 });
  await expect(card).toHaveCount(0, { timeout: 15_000 });
  const row = await prisma.media.findFirst({ where: { filename: NAME } });
  expect(row?.status).toBe("deleted");

  // 清理:回收站行 + 盘上文件族(测试不依赖 7 天后的物理清退)
  if (row) {
    const rel = decodeURIComponent(row.path.replace("/wp-content/uploads/", ""));
    const root = path.resolve(process.cwd(), process.env.MEDIA_DIR ?? "workspace/media");
    const stem = rel.replace(/\.[a-z]+$/, "");
    await Promise.all(
      [rel, `${stem}.webp`, `${stem}.thumb.webp`].map((f) =>
        rm(path.join(root, f), { force: true }),
      ),
    );
    await prisma.media.delete({ where: { id: row.id } });
  }
});

test("8. 一键发文闭环(M5b:md+本地图导入 → 引用替换 → 编辑器交接)", async ({ page }) => {
  const IMG_NAME = "e2e-import-img.png";
  await prisma.media.deleteMany({ where: { filename: IMG_NAME } });

  // 登录(同用例 4/6 的 UI 流)
  await page.goto("/admin/login");
  await page.getByPlaceholder("11 位手机号").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);

  // 列表页 → 一键发文弹窗 → 选 md + 本地图(相对路径引用,按文件名匹配)
  await page.goto("/admin/posts/");
  await page.getByRole("button", { name: "一键发文(md 导入)" }).click();
  const png = await sharp({
    create: { width: 4, height: 3, channels: 3, background: { r: 20, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
  const md = `# E2E 导入\n\n![配图](./imgs/${IMG_NAME})\n`;
  await page.locator('input[type="file"]').setInputFiles([
    { name: "e2e-import.md", mimeType: "text/markdown", buffer: Buffer.from(md, "utf8") },
    { name: IMG_NAME, mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByText("图片引用 1 处")).toBeVisible();
  await page.getByRole("button", { name: "开始导入" }).click();

  // 交接进编辑器:URL 带 import=1,正文引用已替换为站内路径
  await page.waitForURL(/\/admin\/posts\/new\/\?import=1/);
  const ta = page.getByPlaceholder(/正文\(Markdown/);
  await expect(ta).toHaveValue(/!\[配图\]\(\/wp-content\/uploads\//);

  // 清理:媒体行 + 盘上文件族(与用例 7 同款)
  const row = await prisma.media.findFirst({ where: { filename: IMG_NAME } });
  expect(row).toBeTruthy();
  if (row) {
    const rel = decodeURIComponent(row.path.replace("/wp-content/uploads/", ""));
    const root = path.resolve(process.cwd(), process.env.MEDIA_DIR ?? "workspace/media");
    const stem = rel.replace(/\.[a-z]+$/, "");
    await Promise.all(
      [rel, `${stem}.webp`, `${stem}.thumb.webp`].map((f) =>
        rm(path.join(root, f), { force: true }),
      ),
    );
    await prisma.media.delete({ where: { id: row.id } });
  }
});
