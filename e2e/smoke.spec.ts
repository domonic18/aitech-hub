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
