import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

/**
 * E2E 冒烟(standard/01-testing §4):首页//post/<id>-<slug> 文章/legacy 301/308/admin 登录(M4)/
 * SEO 端点/后台发布→前台闭环(M5-a)/电报流前台与后台三页(M7)/博主台账与视频混合流(M8)/
 * AI 治理与解读配额(M9)/主题三段式与首页带可配置(M10)。
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

/** 文章路径(2026-10 URL 终态):/post/<id>-<slug>/ 或 bare-id /post/<id>/ */
const POST_PATH_RE = /^\/post\/\d+(?:-[^/]+)?\/$/;

async function sitemapPostUrls(
  request: import("@playwright/test").APIRequestContext,
): Promise<string[]> {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  return locs.map((u) => new URL(u).pathname).filter((p) => POST_PATH_RE.test(p));
}

test("1. 首页 200 且含 hero 终端与最新文章卡", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("whoami"); // M5-e hero 终端
  expect(html).toContain('href="/articles/"');
  const cardLinks = [...html.matchAll(/href="(\/post\/[^"]+)"/g)].map((m) => m[1]);
  expect(cardLinks.length).toBeGreaterThan(0);
  expect(cardLinks.every((l) => POST_PATH_RE.test(`${l}/`) || POST_PATH_RE.test(l))).toBe(true);
});

test("2. /post/<id>-<slug> 直开文章:200、标题、图片无 broken;非 canonical 308 归一", async ({
  request,
  browser,
}) => {
  const posts = await sitemapPostUrls(request);
  expect(posts.length).toBeGreaterThan(150);
  // canonical 段直开采样 10 篇(id 锚定;slug 为装饰性 ASCII)
  for (const path of posts.slice(0, 10)) {
    expect((await request.get(path)).status()).toBe(200);
  }

  // canonical 归一:bare-id 与任意错误尾巴都 308 到唯一 canonical(slug 改名不破链)
  const canonical = posts.find((p) => p.includes("-"));
  expect(canonical).toBeTruthy();
  const id = canonical!.match(/^\/post\/(\d+)/)![1];
  for (const probe of [`/post/${id}/`, `/post/${id}-junk/`]) {
    const res = await request.get(probe, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    // Next #82117:ISR fallback 冷渲染会双写 Location(进缓存后单头);
    // 浏览器/爬虫按第一个生效,undici 会把重复值 join 成 "a, b" —— 取首值断言
    const location = res.headers().location!.split(",")[0]!.trim();
    expect(new URL(location, "http://localhost:3000").pathname).toBe(canonical);
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

test("3. 弃用 slug:route 精确 301;单段直开永久重定向;URL 迁移行单跳 /post/", async ({
  request,
}) => {
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

  // 2026-10 URL 迁移行:旧中文链 → /post/<id>-<slug>/(目标带尾斜杠 → 单跳 308,不经二次归一)
  const row = await prisma.legacyUrlMap.findFirst({
    where: { targetUrl: { startsWith: "/post/" } },
  });
  expect(row).toBeTruthy();
  const migrated = await request.get(row!.oldPath, { maxRedirects: 0 });
  expect(migrated.status()).toBe(308);
  expect(new URL(migrated.headers().location!, "http://localhost:3000").pathname).toBe(
    row!.targetUrl,
  );

  // 下架删除行的旧链(表内 410/target NULL)→ 404
  const gone = await prisma.legacyUrlMap.findFirst({ where: { httpStatus: 410, targetUrl: null } });
  if (gone) expect((await request.get(gone.oldPath, { maxRedirects: 0 })).status()).toBe(404);

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

  // 4.3b 会话 GET /api/posts 可用(同源 fetch 不带 Origin;读请求免 Origin 关。
  //     曾因守卫无 safe-method 豁免而 403,与路由注释矛盾——回归钉点)
  const list = await page.request.get("/api/posts/");
  expect(list.status()).toBe(200);
  expect(((await list.json()) as { code: number }).code).toBe(0);

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
  // M5-d 起编辑器为 Vditor 分屏:sv 模式可编辑面是 textarea(带 placeholder 的 PRE 为高亮镜像,不能用 getByPlaceholder 定位)
  await page.locator("textarea.vditor-sv").fill("## E2E 正文\n\nM5a 发布闭环冒烟。");
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

  // 前台闭环:/articles/ 出现标题;详情直开 200 且 h1 匹配(发布即 revalidate,不等 ISR);
  // 标题纯中文 → 派生 slug 为 NULL,canonical 走 bare-id(post-path.ts 派生规则同构)
  expect(await (await request.get("/articles/")).text()).toContain(TITLE);
  const seg = post!.slug ? `${post!.id}-${post!.slug}` : `${post!.id}`;
  const detail = await page.goto(`/post/${seg}/`);
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
  expect((await request.get(`/post/${seg}/`)).status()).toBe(404);

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
  const ta = page.locator("textarea.vditor-sv");
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

test("9. 站点统计页五模块可见(M5c:KPI/趋势SVG/来源/环境/热门,分段切换)", async ({ page }) => {
  // 登录(同前序用例 UI 流)
  await page.goto("/admin/login");
  await page.getByPlaceholder("11 位手机号").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);

  // 五模块渲染(空库也不空壳:卡片/表头常在,趋势图恒有 generate_series 点)
  await expect(page.getByText("今日 PV")).toBeVisible();
  await expect(page.getByText("PV / UV 趋势")).toBeVisible();
  await expect(page.getByRole("heading", { name: "流量来源" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "访客环境" })).toBeVisible();
  await expect(page.getByText("热门页面")).toBeVisible();
  const polylines = page.locator("main svg polyline");
  await expect(polylines).toHaveCount(2);

  // hover 趋势图 → client 岛吸附出数据 tip(用户反馈补强)
  await page.locator("svg[aria-label='PV/UV 趋势图']").hover({ position: { x: 200, y: 100 } });
  await expect(page.getByTestId("trend-tip")).toBeVisible();
  await expect(page.getByTestId("trend-tip")).toContainText("PV");

  // 分段切换 URL 驱动:trend=30 生效且 hot 参数跨段保留
  // 「近 30 天」在趋势卡与热门卡各一枚(Link 分段),count=2 证两卡分段均按参数渲染
  await page.goto("/admin/?trend=30&hot=all");
  await expect(page.getByRole("link", { name: "近 30 天" })).toHaveCount(2);
  await expect(page.getByText("该时段暂无页面浏览")).toHaveCount(0);
  await expect(polylines.first()).toBeVisible();
  await page.getByRole("link", { name: "近 90 天" }).click(); // 仅趋势卡有,唯一
  await expect(page).toHaveURL(/trend=90&hot=all/);
});

test("10. PAT 生命周期:UI 创建→Bearer PUT 落草稿→同 slug 重发更新→吊销即 401(M5c)", async ({
  page,
  request,
}) => {
  const TITLE = "E2E 冒烟 PAT 发布 API";
  const SLUG = "e2e-pat-publish";
  const PAT_NAME = "e2e-pat-publish";
  // 与库内残留隔离(重跑幂等)
  await prisma.post.deleteMany({ where: { OR: [{ title: TITLE }, { slug: SLUG }] } });
  await prisma.userPat.deleteMany({ where: { name: PAT_NAME } });

  // 登录 → PAT 页 UI 创建(明文一次性展示)
  await page.goto("/admin/login");
  await page.getByPlaceholder("11 位手机号").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);
  await page.goto("/admin/pats/");
  await page.getByRole("button", { name: "新建令牌" }).click();
  await page.getByPlaceholder("令牌备注(必填,≤100 字)").fill(PAT_NAME);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  const tokenEl = page.getByText(/^ahp_/);
  await expect(tokenEl).toBeVisible();
  const token = (await tokenEl.innerText()).trim();
  expect(token).toMatch(/^ahp_[A-Za-z0-9_-]+$/);
  await page.getByRole("button", { name: "我已保存,关闭" }).click();

  // Bearer 直发(带 frontmatter + 本地随文图):默认落草稿
  const auth = { authorization: `Bearer ${token}` };
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "#5e6ad2" },
  })
    .png()
    .toBuffer();
  const markdown = `---\ntitle: ${TITLE}\nslug: ${SLUG}\ntags: [e2e]\n---\n\n正文配图 ![](img/e2e-pat.png)\n`;
  const putBody = {
    markdown,
    images: [{ name: "e2e-pat.png", mime: "image/png", dataBase64: png.toString("base64") }],
  };
  const r1 = await request.put("/api/posts/", { headers: auth, data: putBody });
  expect(r1.status()).toBe(200);
  const b1 = (await r1.json()) as {
    code: number;
    data: { action: string; id: string; status: string; uploads: Array<{ path: string | null }> };
  };
  expect(b1.code).toBe(0);
  expect(b1.data.action).toBe("created");
  expect(b1.data.status).toBe("draft");
  expect(b1.data.uploads[0]?.path).toMatch(/^\/wp-content\/uploads\//);
  const row = await prisma.post.findUnique({
    where: { slug: SLUG },
    select: { id: true, status: true },
  });
  expect(row?.status).toBe("draft");
  expect(row?.id.toString()).toBe(b1.data.id);

  // 同 slug 重发 = 更新(id 不变)
  const r2 = await request.put("/api/posts/", {
    headers: auth,
    data: { ...putBody, markdown: `${markdown}\n更新追补。\n` },
  });
  const b2 = (await r2.json()) as { code: number; data: { action: string; id: string } };
  expect(b2.data.action).toBe("updated");
  expect(b2.data.id).toBe(b1.data.id);

  // UI 吊销(原生 confirm)→ 行变已吊销
  await page.goto("/admin/pats/");
  const patRow = page.getByRole("row", { name: new RegExp(PAT_NAME) });
  page.once("dialog", (d) => d.accept());
  await patRow.getByRole("button", { name: "吊销" }).click();
  await expect(patRow.getByText("已吊销")).toBeVisible({ timeout: 10_000 });

  // 吊销后同令牌即 401(即时生效)
  const r3 = await request.put("/api/posts/", { headers: auth, data: putBody });
  expect(r3.status()).toBe(401);

  // 清理:文章 + 媒体行 + 盘上文件族(与用例 7 同款)
  await prisma.post.deleteMany({ where: { OR: [{ title: TITLE }, { slug: SLUG }] } });
  const media = await prisma.media.findFirst({ where: { filename: "e2e-pat.png" } });
  expect(media).toBeTruthy();
  if (media) {
    const rel = decodeURIComponent(media.path.replace("/wp-content/uploads/", ""));
    const root = path.resolve(process.cwd(), process.env.MEDIA_DIR ?? "workspace/media");
    const stem = rel.replace(/\.[a-z]+$/, "");
    await Promise.all(
      [rel, `${stem}.webp`, `${stem}.thumb.webp`].map((f) =>
        rm(path.join(root, f), { force: true }),
      ),
    );
    await prisma.media.delete({ where: { id: media.id } });
  }
  await prisma.userPat.deleteMany({ where: { name: PAT_NAME } });
});

test("11. /api/mcp:无 Bearer 401;initialize + tools/list 六工具齐备(M5c)", async ({ request }) => {
  const ENDPOINT = "/api/mcp/";
  // 鉴权在 MCP 协议层之前:无凭证一律 401 + WWW-Authenticate
  const noAuth = await request.post(ENDPOINT, {
    data: { jsonrpc: "2.0", id: 1, method: "ping" },
    headers: { accept: "application/json, text/event-stream" },
  });
  expect(noAuth.status()).toBe(401);
  expect(noAuth.headers()["www-authenticate"]).toContain("Bearer");

  // 直插测试令牌(明文仅测试内可见,断后即清)
  const admin = await prisma.userAccount.findUnique({
    where: { phone: E2E_ADMIN_PHONE },
    select: { id: true },
  });
  expect(admin).toBeTruthy();
  const MCP_PAT = "e2e-pat-mcp";
  const token = `ahp_${randomBytes(32).toString("base64url")}`;
  await prisma.userPat.create({
    data: {
      userId: admin!.id,
      name: MCP_PAT,
      tokenHash: createHash("sha256").update(token).digest("hex"),
    },
  });
  try {
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
    const init = await request.post(ENDPOINT, {
      headers,
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "e2e", version: "0.0.0" },
        },
      },
    });
    expect(init.status()).toBe(200);
    const initBody = (await init.json()) as { result: { serverInfo: { name: string } } };
    expect(initBody.result.serverInfo.name).toBe("aitech-hub");

    const list = await request.post(ENDPOINT, {
      headers,
      data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
    const tools = (await list.json()) as { result: { tools: Array<{ name: string }> } };
    const names = tools.result.tools.map((t) => t.name);
    for (const t of [
      "upsert_article",
      "upload_media",
      "get_article",
      "list_articles",
      "publish",
      "unpublish",
    ]) {
      expect(names).toContain(t);
    }

    // GET(独立 SSE 流)/ DELETE(会话终止)不开放 → 405,不留半实现
    expect((await request.get(ENDPOINT, { headers })).status()).toBe(405);
  } finally {
    await prisma.userPat.deleteMany({ where: { name: MCP_PAT } });
  }
});

test("12. 电报流前台(M7:/telegram noindex 双保险/公共 API/首页 LIVE 带/不入 sitemap)", async ({
  request,
}) => {
  const MARK = "e2e-telegram-mark";
  // 自播种:独立渠道(采集关闭)+ 一条可见电报(publishedAt=now 保证排进带首;重跑幂等)
  const source = await prisma.crawlSource.upsert({
    where: { name: "e2e-telegram-source" },
    update: {},
    create: {
      name: "e2e-telegram-source",
      type: "rss",
      url: "https://e2e.invalid/rss",
      enabled: false,
      remark: "e2e 专用,采集关闭",
    },
  });
  await prisma.telegram.deleteMany({ where: { sourceId: source.id, title: MARK } });
  await prisma.telegram.create({
    data: {
      sourceId: source.id,
      title: MARK,
      summary: "e2e 冒烟摘要",
      url: "https://e2e.invalid/item/1",
      publishedAt: new Date(),
      contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
    },
  });

  try {
    // noindex 双保险:X-Robots-Tag 响应头 + 页内 robots meta;LIVE 头标与播种条目在
    const feed = await request.get("/telegram/");
    expect(feed.status()).toBe(200);
    expect(feed.headers()["x-robots-tag"]).toBe("noindex, follow");
    const html = await feed.text();
    expect(html).toMatch(/name="robots" content="noindex[^"]*"/);
    expect(html).toContain("LIVE · 持续采集中");
    expect(html).toContain(MARK);

    // 公共 API:no-store;出参 BigInt 已字符串化;today 含播种条目
    const api = await request.get("/api/telegram/public/");
    expect(api.status()).toBe(200);
    expect(api.headers()["cache-control"]).toContain("no-store");
    const body = (await api.json()) as {
      code: number;
      data: {
        items: Array<{ id: string; title: string; sourceName: string; publishedAt: string }>;
        today: number;
      };
    };
    expect(body.code).toBe(0);
    const hit = body.data.items.find((i) => i.title === MARK);
    expect(hit).toBeTruthy();
    expect(typeof hit!.id).toBe("string");
    expect(body.data.today).toBeGreaterThan(0);

    // 首页 LIVE 带壳在(SSR;条目轮询由 /telegram 页与 API 覆盖,首页 ISR 缓存不断言 MARK)
    const home = await (await request.get("/")).text();
    expect(home).toContain("tail -f /telegram");
    expect(home).toContain('href="/telegram/"');

    // SEO 红线:电报流不入 sitemap(显式页面清单)
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/telegram");
  } finally {
    await prisma.telegram.deleteMany({ where: { sourceId: source.id } });
    await prisma.crawlSource.delete({ where: { id: source.id } });
  }
});

test("13. 电报流后台三页可见(M7:渠道台账/流治理/采集总览)", async ({ page }) => {
  // 登录(同前序用例 UI 流)
  await page.goto("/admin/login");
  await page.getByPlaceholder("11 位手机号").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);

  // 渠道台账:页头说明 + 新增入口
  await page.goto("/admin/channels/");
  await expect(page.getByText("采集渠道台账")).toBeVisible();
  await expect(page.getByRole("button", { name: "新增渠道" })).toBeVisible();

  // 流治理:分段 tabs(带计数)+ 屏蔽词管理岛
  await page.goto("/admin/telegram/");
  await expect(page.getByRole("link", { name: /^全部 \d+$/ })).toBeVisible();
  await expect(page.getByText(/屏蔽词/).first()).toBeVisible();

  // 采集总览:tick 调度卡 + 双队列实况(M9:interpreter 真实计数与日配额)
  await page.goto("/admin/spider/");
  await expect(page.getByRole("heading", { name: "采集总览" })).toBeVisible();
  await expect(page.getByText("tick 调度器", { exact: true })).toBeVisible();
  await expect(page.getByText("双队列实况")).toBeVisible();
  await expect(page.getByText("interpreter", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/视频解读 · 下载 \/ 抽轨 \/ ASR \/ LLM · 并发 1 · 今日 \d+\/\d+/),
  ).toBeVisible();
  await expect(page.getByText(/日配额超限延迟 30min 重投/)).toBeVisible();
});

test("14. 博主台账与视频混合流(M8:bloggers 页/两步武装删除/启停物理删/media 筛选)", async ({
  page,
  request,
}) => {
  const NICK = "e2e-抖音博主";
  const SEC_UID = "MS4wLjABAAAAe2e_video_blogger_0000";
  const MARK_V = "e2e-视频电报-mark";
  // M9:播种已解读态(ai_* 列),断言前台 AI 卡与治理台徽章;按钮不点击,避免真入队
  const AI_TOPIC = "e2e 大模型解读主题";
  const AI_SUMMARY = "e2e 解读摘要:大模型对该视频内容的概括文本,供前台 AI 解读卡冒烟断言。";
  const AI_POINTS = ["要点甲", "要点乙", "要点丙"];
  // 自播种:专属平台行(停用 → 页面应现「平台已停用」;不触真实调度)+ 启用中博主 + 视频电报行
  const platformRow = await prisma.crawlSource.upsert({
    where: { name: "e2e-social:douyin" },
    update: { enabled: false },
    create: {
      name: "e2e-social:douyin",
      type: "social-video",
      platform: "douyin",
      url: "https://e2e.invalid/douyin",
      enabled: false,
      remark: "e2e 专用",
    },
  });
  await prisma.socialAccount.deleteMany({ where: { secUid: SEC_UID } });
  const blogger = await prisma.socialAccount.create({
    data: {
      platformRowId: platformRow.id,
      platform: "douyin",
      secUid: SEC_UID,
      nickname: NICK,
      category: "AI 资讯",
    },
  });
  await prisma.telegram.deleteMany({ where: { sourceId: platformRow.id, title: MARK_V } });
  await prisma.telegram.create({
    data: {
      sourceId: platformRow.id,
      title: MARK_V,
      summary: "e2e 视频卡冒烟",
      url: "https://www.douyin.com/video/e2e0001",
      publishedAt: new Date(),
      contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
      mediaType: "video",
      videoPlatform: "douyin",
      videoBlogger: NICK,
      videoCoverUrl: "https://e2e.invalid/cover-e2e0001.jpg",
      videoDuration: 213,
      videoEngagement: { play: 12000, like: 345, comment: 67 },
      aiStatus: "done",
      aiTopic: AI_TOPIC,
      aiSummary: AI_SUMMARY,
      aiPoints: AI_POINTS,
      aiRanAt: new Date(),
    },
  });

  try {
    // 登录(同前序用例 UI 流)
    await page.goto("/admin/login");
    await page.getByPlaceholder("11 位手机号").fill(E2E_ADMIN_PHONE);
    await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await page.waitForURL(/\/admin\/?$/);

    // 台账页:双状态卡 + 播种行(平台行停用 → 健康列「平台已停用」徽标)
    await page.goto("/admin/bloggers/");
    await expect(page.getByRole("button", { name: "登记博主" })).toBeVisible();
    await expect(page.getByText("抖音网关(douyin-gateway)")).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(NICK) });
    await expect(row).toBeVisible();
    await expect(row.getByText("平台已停用")).toBeVisible();

    // 博主作品入口(批⑦):行内 secUid 外链拼抖音主页(删除前断言,删后行不在)
    await expect(row.getByRole("link", { name: `打开 ${NICK} 的主页` })).toHaveAttribute(
      "href",
      `https://www.douyin.com/user/${SEC_UID}`,
    );

    // 「作品」「回填」ops(批⑧):作品链站内筛选;回填按钮可见但平台行停用 → 409
    await expect(row.getByRole("link", { name: "作品" })).toHaveAttribute(
      "href",
      `/admin/telegram/?media=video&blogger=${encodeURIComponent(NICK)}`,
    );
    await expect(row.getByRole("button", { name: "回填" })).toBeVisible();
    const bf = await page.request.post(`/api/bloggers/${blogger.id}/backfill/`, {
      headers: { origin: "http://localhost:3000" },
    });
    expect(bf.status()).toBe(409); // 播种平台行停用 → disabled,零 worker 依赖

    // 两步武装删除·UI 侧:启用中删除被客户端守卫拦(alert,不发请求,行仍在)
    const alertPromise = page.waitForEvent("dialog").then((d) => {
      const msg = d.message();
      void d.accept();
      return msg;
    });
    await row.getByRole("button", { name: "删除" }).click();
    expect(await alertPromise).toContain("先停用再删除");
    await expect(row).toBeVisible();
    // 两步武装删除·服务端同判:session DELETE 直打启用中博主 → 409
    // (mutation 有 Origin 关:page.request 不自动带,须显式补同源 Origin,同 4.3b 注)
    const del = await page.request.delete(`/api/bloggers/${blogger.id}/`, {
      headers: { origin: "http://localhost:3000" },
    });
    expect(del.status()).toBe(409);

    // 停用(confirm)→ 行刷新出「启用」;启用态专属按钮(立即采集/回填)随之隐藏
    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: "停用" }).click();
    await expect(row.getByRole("button", { name: "启用" })).toBeVisible({ timeout: 10_000 });
    await expect(row.getByRole("button", { name: "回填" })).toBeHidden();
    await expect(row.getByRole("button", { name: "立即采集" })).toBeHidden();
    // 删除(confirm)→ 物理删,行消失
    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: "删除" }).click();
    await expect(row).toBeHidden({ timeout: 10_000 });
    expect(await prisma.socialAccount.count({ where: { secUid: SEC_UID } })).toBe(0);
    // 博主删除不影响已入库视频条目(video_blogger 冗余隔离,arch/02 §3.2)
    expect(
      await prisma.telegram.count({ where: { sourceId: platformRow.id, title: MARK_V } }),
    ).toBe(1);

    // 后台媒体筛选(批⑦):video 页含播种行(封面/原视频链/平台·博主),text 页不含
    await page.goto("/admin/telegram/?media=video");
    const vRow = page.getByRole("row", { name: new RegExp(MARK_V) });
    await expect(vRow).toBeVisible();
    await expect(vRow.getByRole("img", { name: MARK_V })).toBeVisible();
    await expect(vRow.getByRole("link", { name: /打开原视频/ })).toBeVisible();
    await expect(vRow.getByText(`抖音 · ${NICK}`)).toBeVisible();
    // M9:已解读徽章 + 行内「解读」按钮在(不点击——真按会下载/转写入队)
    await expect(vRow.getByText("已解读")).toBeVisible();
    await expect(vRow.getByRole("button", { name: "解读", exact: true })).toBeVisible();
    await page.goto("/admin/telegram/?media=text");
    await expect(page.getByRole("row", { name: new RegExp(MARK_V) })).toHaveCount(0);

    // 博主作品筛选(批⑧):?blogger= 命中播种行,活动 chip 呈现且可清除
    await page.goto(`/admin/telegram/?media=video&blogger=${encodeURIComponent(NICK)}`);
    await expect(page.getByRole("row", { name: new RegExp(MARK_V) })).toBeVisible();
    const chip = page.locator(`a[title="清除博主筛选"]`); // title 不参与 accessible name,按属性定位
    await expect(chip).toHaveText(`博主:${NICK} ✕`);
    await chip.click();
    await expect(page).toHaveURL(/\/admin\/telegram\/\?(?!.*blogger=)/);
    await expect(page.getByRole("row", { name: new RegExp(MARK_V) })).toBeVisible(); // media=video 仍在

    // 前台 media 筛选:video 页含播种视频卡(平台·博主 chip),text 页不含;非法值回落 all
    const videoHtml = await (await request.get("/telegram/?media=video")).text();
    expect(videoHtml).toContain(MARK_V);
    expect(videoHtml).toContain(`抖音 · ${NICK}`);
    expect(await (await request.get("/telegram/?media=text")).text()).not.toContain(MARK_V);
    expect(await (await request.get("/telegram/?media=junk")).text()).toContain(MARK_V);

    // 前台视频卡(M10 批③ 原型重排):卡内标题/封面链/平台角标/时长/互动数 +
    // AI 解读徽章 + 摘要 + 要点 details(展开见 3 条)+ 尾注
    await page.goto("/telegram/?media=video");
    const aiCard = page.getByRole("article").filter({ hasText: MARK_V });
    await expect(aiCard.getByRole("heading", { name: MARK_V })).toBeVisible();
    await expect(aiCard.getByRole("link", { name: /打开原视频/ })).toBeVisible();
    await expect(aiCard.getByText("抖音", { exact: true })).toBeVisible(); // 平台角标
    await expect(aiCard.getByText("3:33", { exact: true })).toBeVisible(); // 213s
    await expect(aiCard.getByText("1.2w", { exact: true })).toBeVisible(); // 播放 12000
    await expect(aiCard.getByText("345", { exact: true })).toBeVisible(); // 点赞
    await expect(aiCard.getByText("AI 解读")).toBeVisible();
    await expect(aiCard.getByText(AI_SUMMARY)).toBeVisible();
    await expect(aiCard.getByText(/关键要点 ×3/)).toBeVisible();
    await aiCard.getByText(/关键要点 ×3/).click();
    await expect(aiCard.getByText("要点甲")).toBeVisible();
    await expect(aiCard.getByText("AI 生成 · 摘要与要点,内容版权归原作者")).toBeVisible();

    // 公共 API media 参数:video 过滤命中且视频字段投影齐备;text 过滤不含
    const apiV = await request.get("/api/telegram/public/?media=video&limit=50");
    const bv = (await apiV.json()) as {
      code: number;
      data: {
        items: Array<{
          title: string;
          mediaType: string;
          video: {
            platform: string;
            blogger: string;
            durationSeconds: number;
            engagement: { like: number };
            ai: { topic: string; summary: string; points: string[] } | null;
          } | null;
        }>;
      };
    };
    expect(bv.code).toBe(0);
    const hit = bv.data.items.find((i) => i.title === MARK_V);
    expect(hit).toBeTruthy();
    expect(hit!.mediaType).toBe("video");
    expect(hit!.video).toMatchObject({ platform: "douyin", blogger: NICK, durationSeconds: 213 });
    expect(hit!.video!.engagement.like).toBe(345);
    // M9:公共 API 投影带 ai 解读结论(白名单三字段)
    expect(hit!.video!.ai).toEqual({ topic: AI_TOPIC, summary: AI_SUMMARY, points: AI_POINTS });
    const bt = (await (await request.get("/api/telegram/public/?media=text&limit=50")).json()) as {
      data: { items: Array<{ title: string }> };
    };
    expect(bt.data.items.find((i) => i.title === MARK_V)).toBeUndefined();
  } finally {
    await prisma.socialAccount.deleteMany({ where: { secUid: SEC_UID } });
    await prisma.telegram.deleteMany({ where: { sourceId: platformRow.id } });
    await prisma.crawlSource.deleteMany({ where: { name: "e2e-social:douyin" } });
  }
});

test("15. AI 模型治理后台(M8 批⑥:三 Tab/Key 脱敏与留空保留/绑定校验/ASR/测试优雅失败)", async ({
  page,
}) => {
  const BASE_NAME = "e2e-无钥模型";
  const KEYED_NAME = "e2e-密钥模型";
  const KEYED_RENAME = "e2e-密钥模型-改";
  const PLAIN_KEY = "e2e-secretkey-1234";
  // 自播种:无钥模型(summarize 用途)+ 前置清理 e2e 痕迹(spec 不 import secret-box,密文仅经 API 路径落库)
  await prisma.aiModel.deleteMany({ where: { name: { startsWith: "e2e-" } } });
  const base = await prisma.aiModel.create({
    data: {
      name: BASE_NAME,
      provider: "DeepSeek",
      protocol: "openai",
      baseUrl: "https://e2e.invalid/v1",
      modelId: "e2e-base",
      purposes: ["summarize"],
    },
  });

  try {
    await page.goto("/admin/login");
    await page.getByPlaceholder("11 位手机号").fill(E2E_ADMIN_PHONE);
    await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await page.waitForURL(/\/admin\/?$/);

    // 三 Tab + 台账:播种行可见,API Key 列显「无鉴权」
    await page.goto("/admin/models/");
    await expect(page.getByRole("tab", { name: /模型条目/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: "ASR 渠道" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "任务绑定" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ 新增模型" })).toBeVisible();
    const baseRow = page.getByRole("row", { name: new RegExp(BASE_NAME) });
    await expect(baseRow).toBeVisible();
    await expect(baseRow).toContainText("无鉴权");

    // UI 建模带 Key → 行显掩码,全 DOM 无明文,DB 密文 ≠ 明文
    await page.getByRole("button", { name: "+ 新增模型" }).click();
    await page.getByPlaceholder("如:解读主力 / Agent 搜索").fill(KEYED_NAME);
    await page.getByRole("button", { name: "文字摘要", exact: true }).click();
    await page.getByPlaceholder("如 deepseek-chat").fill("e2e-keyed");
    await page
      .getByPlaceholder("https://api.deepseek.com(可粘完整端点,自动剥尾缀)")
      .fill("https://e2e.invalid/v1/chat/completions");
    await page.getByPlaceholder("••••••••").fill(PLAIN_KEY);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    const keyedRow = page.getByRole("row", { name: new RegExp(KEYED_NAME) });
    await expect(keyedRow).toBeVisible({ timeout: 10_000 });
    await expect(keyedRow).toContainText("e2e****1234");
    expect(await page.content()).not.toContain(PLAIN_KEY);
    // URL 尾缀自动剥:粘 /chat/completions 落库为裸 base
    const keyed = await prisma.aiModel.findFirstOrThrow({ where: { name: KEYED_NAME } });
    expect(keyed.baseUrl).toBe("https://e2e.invalid/v1");
    expect(keyed.apiKeyEnc).toBeTruthy();
    expect(keyed.apiKeyEnc).not.toContain(PLAIN_KEY);
    expect(keyed.apiKeyMask).toBe("e2e****1234");

    // 编辑留空 API Key = 保留旧钥(密文逐字节不变)
    await keyedRow.getByRole("button", { name: "编辑" }).click();
    await page.getByPlaceholder("如:解读主力 / Agent 搜索").fill(KEYED_RENAME);
    await expect(page.getByPlaceholder("••••••••")).toHaveValue("");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("row", { name: new RegExp(KEYED_RENAME) })).toBeVisible({
      timeout: 10_000,
    });
    const after = await prisma.aiModel.findUniqueOrThrow({ where: { id: keyed.id } });
    expect(after.apiKeyEnc).toBe(keyed.apiKeyEnc);

    // 任务绑定:文字摘要卡 主力=无钥模型 备用=密钥模型 → 保存;定位列派生徽标
    await page.getByRole("tab", { name: "任务绑定" }).click();
    const sumCard = page.getByRole("group", { name: "文字摘要绑定" });
    await sumCard.getByLabel("文字摘要主力模型").selectOption({ label: "e2e-base(DeepSeek)" });
    await sumCard.getByLabel("文字摘要备用模型").selectOption({ label: "e2e-keyed(DeepSeek)" });
    await sumCard.getByRole("button", { name: "保存" }).click();
    await expect(sumCard).toContainText("已保存");
    const sumBinding = await prisma.aiTaskBinding.findUniqueOrThrow({
      where: { role: "summarize" },
    });
    expect(sumBinding.primaryId).toBe(base.id);
    expect(sumBinding.backupId).toBe(keyed.id);

    // M9 批⑥:解读日配额后台化——interpret 卡日配额输入在;API 改值落库后还原
    // (只写 dailyMax,主/备用引用原样带回,不动真实绑定)
    const interpretCard = page.getByRole("group", { name: "电报解读绑定" });
    await expect(interpretCard.getByLabel("解读日配额")).toBeVisible();
    const beforeQuota = await prisma.aiTaskBinding.findUniqueOrThrow({
      where: { role: "interpret" },
    });
    const quotaPut = await page.request.put("/api/model-bindings", {
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      data: {
        role: "interpret",
        primaryId: beforeQuota.primaryId,
        backupId: beforeQuota.backupId,
        dailyMax: 25,
      },
    });
    expect(quotaPut.status()).toBe(200);
    expect(
      (await prisma.aiTaskBinding.findUniqueOrThrow({ where: { role: "interpret" } })).dailyMax,
    ).toBe(25);
    await page.request.put("/api/model-bindings", {
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      data: {
        role: "interpret",
        primaryId: beforeQuota.primaryId,
        backupId: beforeQuota.backupId,
        dailyMax: beforeQuota.dailyMax,
      },
    });

    // 服务端绑定校验:purposes 不匹配 → 400;主备同模型 → 400(mutation 带 Origin,同 14)
    const badPurpose = await page.request.put("/api/model-bindings", {
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      data: { role: "search", primaryId: base.id, backupId: null },
    });
    expect(badPurpose.status()).toBe(400);
    expect(((await badPurpose.json()) as { message: string }).message).toContain("用途");
    const badSame = await page.request.put("/api/model-bindings", {
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      data: { role: "summarize", primaryId: base.id, backupId: base.id },
    });
    expect(badSame.status()).toBe(400);
    expect(((await badSame.json()) as { message: string }).message).toContain("主力与备用");

    // ASR 渠道:UI 编辑生效(单例持久化);注记防误报文案在页
    await page.getByRole("tab", { name: "ASR 渠道" }).click();
    await expect(page.getByText("转写文本为空属正常")).toBeVisible();
    await page.getByRole("button", { name: "编辑配置" }).click();
    await page.getByPlaceholder("如 阿里云智能语音 / MiniMax").fill("e2e-ASR供应商");
    await page
      .getByPlaceholder("https://asr.example.com(可粘完整端点,自动剥尾缀)")
      .fill("https://e2e.invalid");
    await page.getByRole("button", { name: "保存", exact: true }).last().click();
    await expect(page.getByText("e2e-ASR供应商")).toBeVisible({ timeout: 10_000 });
    const asrRow = await prisma.asrConfig.findUniqueOrThrow({ where: { id: 1 } });
    expect(asrRow.provider).toBe("e2e-ASR供应商");
    expect(asrRow.baseUrl).toBe("https://e2e.invalid");

    // 模型条目:对 e2e.invalid 点测试 → 优雅失败(行显 ✗,DB 落 fail),不抛 500
    await page.getByRole("tab", { name: /模型条目/ }).click();
    await baseRow.getByRole("button", { name: "测试", exact: true }).click();
    await expect(baseRow.getByText("✗ 失败")).toBeVisible({ timeout: 20_000 });
    const baseAfter = await prisma.aiModel.findUniqueOrThrow({ where: { id: base.id } });
    expect(baseAfter.lastTestStatus).toBe("fail");
    expect(baseAfter.lastTestError).toBeTruthy();
  } finally {
    // 解绑引用(仅 e2e 模型)→ 清 e2e 模型与 ASR 单例(下次运行重建)
    const e2eIds = (
      await prisma.aiModel.findMany({
        where: { name: { startsWith: "e2e-" } },
        select: { id: true },
      })
    ).map((r) => r.id);
    await prisma.aiTaskBinding.updateMany({
      where: { OR: [{ primaryId: { in: e2eIds } }, { backupId: { in: e2eIds } }] },
      data: { primaryId: null, backupId: null },
    });
    await prisma.aiModel.deleteMany({ where: { name: { startsWith: "e2e-" } } });
    await prisma.asrConfig.deleteMany({ where: { provider: "e2e-ASR供应商" } });
  }
});

test("16. 主题三段式(M10 批①:系统跟随/实时变化/显式选择优先/胶囊翻转持久化)", async ({
  browser,
}) => {
  // 全新上下文 = 无 localStorage 的「新访客」;从暗色系统偏好开始
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();

  // 无显式选择:跟随系统 → 暗;系统偏好实时变化,不重载即跟随
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // 胶囊点击 = 显式选择:翻转 + 落 localStorage;显式 dark 压过 light 系统(重载后仍 dark)
  await page.locator(".theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("ah-theme"))).toBe("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // 显式 light 压过暗色系统;清掉显式选择后回落系统(当前 light)
  await page.evaluate(() => localStorage.setItem("ah-theme", "light"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light"); // 显式选择不被系统翻转
  await page.evaluate(() => localStorage.removeItem("ah-theme"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await ctx.close();
});

test("17. 首页带可配置 + 滚动加载(M10 批②:site_config/设置页/offset 翻页/到底提示)", async ({
  page,
}) => {
  // 自播种:独立渠道 + 15 条可见文字电报(> 默认 12;publishedAt 逐分钟递减保证确定性排序)
  const source = await prisma.crawlSource.upsert({
    where: { name: "e2e-band-source" },
    update: {},
    create: {
      name: "e2e-band-source",
      type: "rss",
      url: "https://e2e.invalid/band-rss",
      enabled: false,
      remark: "e2e 专用,采集关闭",
    },
  });
  const BAND_URL = (i: number): string => `https://e2e.invalid/band/${i}`;
  await prisma.telegram.deleteMany({ where: { sourceId: source.id } });
  await prisma.telegram.createMany({
    data: Array.from({ length: 15 }, (_, i) => ({
      sourceId: source.id,
      title: `e2e-band-${String(i).padStart(2, "0")}`,
      summary: "e2e 带条目",
      url: BAND_URL(i),
      publishedAt: new Date(Date.now() - i * 60_000),
      contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
    })),
  });
  // 记住原配置(行缺=null)测后还原
  const original = await prisma.siteConfig.findUnique({ where: { key: "band.item_count" } });
  const rows = page.locator("a[href^='https://e2e.invalid/band/']");

  try {
    // admin 登录 → 设置页:初值=默认 12,改成 3 保存
    await page.goto("/admin/login");
    await page.getByPlaceholder("11 位手机号").fill(E2E_ADMIN_PHONE);
    await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await page.waitForURL(/\/admin\/?$/);
    await page.goto("/admin/settings/");
    const input = page.getByLabel("首页电报流条数");
    await expect(input).toHaveValue("12");
    await input.fill("3");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("已保存,首页即将按新条数再生")).toBeVisible();

    // 落库 + GET API 回读;revalidatePath 后首页 SSR 立即 3 行
    expect(
      (await prisma.siteConfig.findUniqueOrThrow({ where: { key: "band.item_count" } })).value,
    ).toBe("3");
    const cfg = await page.request.get("/api/site-config");
    expect(((await cfg.json()) as { data: { bandItemCount: number } }).data.bandItemCount).toBe(3);
    await page.goto("/");
    await expect(rows).toHaveCount(3);

    // 下滚:哨兵自动追加载至 15 条 + 到底提示(offset 分页 + id 去重)
    for (let i = 0; i < 12 && (await rows.count()) < 15; i++) {
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(250);
    }
    await expect(rows).toHaveCount(15);
    // 到底判定:补一滚让哨兵再触发 offset=15 的空页(< count 判定到底)
    await page.mouse.wheel(0, 2000);
    await expect(page.getByText("— 已加载全部 —")).toBeVisible({ timeout: 10_000 });
  } finally {
    // 还原:回写原值(原无行 → 写默认 12 后删行),清播种数据
    const origin = { "content-type": "application/json", origin: "http://localhost:3000" };
    await page.request.put("/api/site-config", {
      headers: origin,
      data: { bandItemCount: original ? Number(original.value) : 12 },
    });
    if (original === null) {
      await prisma.siteConfig.deleteMany({ where: { key: "band.item_count" } });
    }
    await prisma.telegram.deleteMany({ where: { sourceId: source.id } });
    await prisma.crawlSource.delete({ where: { id: source.id } });
  }
});
