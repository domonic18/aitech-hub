import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import sharp from "sharp";

import { composeWritingText } from "../../src/lib/topics/writing-config";

/**
 * E2E 冒烟(standard/01-testing §4):首页//post/<id>-<slug> 文章/legacy 301/308/admin 登录(M4)/
 * SEO 端点/后台发布→前台闭环(M5-a)/电报流前台与后台三页(M7)/博主台账与视频混合流(M8)/
 * AI 治理与解读配额(M9)/主题三段式与首页带可配置(M10)/GitHub 项目展示三件套(M11)/
 * 站点设置扩展·文章视图切换·菜单精简·带文字行 AI 轻解读·摘要要点/关键词双列(M12)/
 * 用量统计看板与牌价·封面工作流冒烟(M14)/K1 三域统一检索分组命中(K1)/
 * 公众号同步草稿:配置卡+未就绪 400+弹窗预填+批量 skipped+绑定重置(M17)/
 * K2.5 Drawer 深挖会话:线程 API 面+唤起预填+无绑定降级+侧栏删除(K2.5)/
 * 文章评论与点赞:评论区渲染/两级楼层/游客点赞去重回退(M23)/
 * 优质内容发现治理台:词库管理与候选人工终审(M25)。
 * 创作中心:新建/挂载素材(仅已解读)/批注/人工状态流转/双配置/产出动作防线(M26 批③,M42 重构)。
 * 飞书免登底座:登录页非飞书零回归/兑换未启用 403/status 凭证齐透传·未配置 403/bind 未登录 401(M29,零真网)。
 * Agent 技能:后台页签 CRUD 冒烟(key 建后不可改)/启停落库/专题绑定写作技能/非法 skillKey 400(M30 批④,零真网)。
 * 样例参照图库与写作配置回写:图库路由鉴权/上传边界/重命名删除软引用/topic 绑定核/五形式 skillKey 回写(M39 批③⑤,零真网)。
 * 映射样例取自 legacy_url_map 真实行(迁移产物,与库内数据耦合是验收本意)。
 */

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
/** K2.6 游客配额/归属键种子(与应用同库:REDIS_URL,本地 6380) */
const e2eRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6380/0", {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});

/** e2e 专用 admin 账号(本地库幂等 upsert;与开发者个人账号隔离) */
const E2E_ADMIN_PHONE = "13800000000";
const E2E_ADMIN_PASSWORD = "e2e-admin-pass1";

test.afterAll(async () => {
  await prisma.$disconnect();
  e2eRedis.disconnect();
});

/** 游客提问日限键(K2.6 quota 同式:statsDay=sv-SE 北京日界,YYYY-MM-DD) */
function guestAskKey(visitorId: string): string {
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  return `search:agent:guest:ask:${visitorId}:${day}`;
}
const LEGACY_TO_ARTICLES =
  "/%e9%a6%96%e4%b8%aagpu%e9%ab%98%e7%ba%a7%e8%af%ad%e8%a8%80%ef%bc%8c%e5%a4%a7%e8%a7%84%e6%a8%a1%e5%b9%b6%e8%a1%8c%e5%b0%b1%e5%83%8f%e5%86%99python%ef%bc%8c%e5%b7%b2%e8%8e%b78500-star/";
const LEGACY_TO_HOME = "/ai%e8%a7%86%e9%a2%91%e5%b7%a5%e5%85%b7/";

/** 文章路径(2026-10 URL 终态):/post/<id>-<slug>/ 或 bare-id /post/<id>/ */
const POST_PATH_RE = /^\/post\/\d+(?:-[^/]+)?\/$/;

/** mutation 同源 Origin(运行时取服务源:e2e 可在备用端口起服,写死 :3000 会被同源关 403) */
function originOf(page: import("@playwright/test").Page): string {
  return new URL(page.url()).origin;
}

function jsonOrigin(page: import("@playwright/test").Page): Record<string, string> {
  return { "content-type": "application/json", origin: originOf(page) };
}

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
      // M27 批⑥ 起正文图 lazy 加载:视口外图片不加载(naturalWidth=0)是预期
      // 行为而非 broken——先滚动到首图触发加载,等至少一张完成解码再断言
      await imgs.first().scrollIntoViewIfNeeded();
      await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll("article img")].some(
              (i) => (i as HTMLImageElement).naturalWidth > 0,
            ),
          undefined,
          { timeout: 10_000 },
        )
        .catch(() => {});
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

  // 4.2 错误密码 → 模糊提示(不区分账号锁定/密码错;M21批⓪ 起文案为「账号或密码」)
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill("wrong-pass-9");
  await page.getByRole("button", { name: "登录控制台" }).click();
  await expect(page.getByText("账号或密码不正确")).toBeVisible();

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
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
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
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);

  // 统计卡与工具条
  await page.goto("/admin/media/");
  await expect(page.getByText("近 30 天 / 未引用")).toBeVisible();

  // 上传(setInputFiles 直喂缓冲,无需夹具文件)→ refresh 后卡片出现。
  // 底色须与 41 号样图(30/144/255)区分:同字节 PNG sha1 相同,媒体去重会
  // 把本例上传并到旧行,卡片 alt 永远不出现(数据态耦合,2026-10-22 实锤)
  const png = await sharp({
    create: { width: 4, height: 3, channels: 3, background: { r: 88, g: 24, b: 210 } },
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
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
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
  // M16 起 md 与图片分离两入口(可跨目录多次补选):md 直填,图片经「添加图片」
  await page
    .locator('input[accept=".md,.markdown"]')
    .setInputFiles([
      { name: "e2e-import.md", mimeType: "text/markdown", buffer: Buffer.from(md, "utf8") },
    ]);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "添加图片" }).click(),
  ]);
  await chooser.setFiles([{ name: IMG_NAME, mimeType: "image/png", buffer: png }]);
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

test("9. 站点统计页六模块可见(M5c:KPI/趋势SVG/来源/环境/热门,分段切换)+ 搜索词排行(2026-10-06)+ 最近访问明细(M10 批⑥)", async ({
  page,
  request,
}) => {
  // 访问明细/搜索词隔离(重跑幂等):日聚合页表也要清——本用例的 beacon 会累加
  // stats_page_daily,重跑几轮后伪路径挤进「热门页面」表,与最近访问行 strict 相撞
  const visitPath = "/e2e-visit-log";
  await prisma.statsVisitLog.deleteMany({ where: { path: visitPath } });
  await prisma.statsPageDaily.deleteMany({ where: { path: visitPath } });
  const searchTerm = "e2e 热搜词";
  await prisma.statsSearchLog.deleteMany({ where: { term: searchTerm } });

  // 登录(同前序用例 UI 流)
  await page.goto("/admin/login");
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);

  // beacon 直打(M10 批⑥):request 上下文无 cookie(非管理员可入账);
  // 本地无反代头,自置 x-forwarded-for 模拟 nginx 形态(clientIp 取首跳);
  // UA 用真实浏览器串(playwright 字样被 isBotUa 过滤,正是生产口径)
  const beaconHeaders = {
    origin: originOf(page),
    "x-forwarded-for": "203.0.113.7",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  };
  const beacon = await request.post("/api/view", {
    headers: beaconHeaders,
    data: { path: visitPath, referrer: "" },
  });
  expect(beacon.status()).toBe(204);

  // 搜索词排行(2026-10-06):仅 /search 页 counted PV 记词——空白折叠归一(两发同词 → 次数 2);
  // 非 /search 路径与纯空白词不记
  for (const data of [
    { path: "/search", referrer: "", q: `  ${searchTerm}  ` },
    { path: "/search", referrer: "", q: searchTerm },
    { path: "/post/", referrer: "", q: searchTerm },
    { path: "/search", referrer: "", q: "   " },
  ]) {
    const r = await request.post("/api/view", { headers: beaconHeaders, data });
    expect(r.status()).toBe(204);
  }

  // 六模块渲染(空库也不空壳:卡片/表头常在,趋势图恒有 generate_series 点)
  await page.goto("/admin/");
  await expect(page.getByText("今日 PV")).toBeVisible();
  await expect(page.getByText("PV / UV 趋势")).toBeVisible();
  await expect(page.getByRole("heading", { name: "流量来源" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "访客环境" })).toBeVisible();
  await expect(page.getByText("热门页面")).toBeVisible();
  await expect(page.getByText("热门搜索")).toBeVisible();
  const polylines = page.locator("main svg polyline");
  await expect(polylines).toHaveCount(2);

  // 搜索词排行行:两次 /search counted beacon(其一带首尾空白)归一为同词 → 次数 2;
  // 断言后即清
  const termRow = page.getByRole("row", { name: new RegExp(searchTerm) });
  await expect(termRow).toBeVisible();
  await expect(termRow.locator("td").last()).toHaveText("2");
  await prisma.statsSearchLog.deleteMany({ where: { term: searchTerm } });

  // 最近访问明细行(M10 批⑥):伪路径 + 全量 IP;断言后即清
  const visitRow = page.getByRole("row", { name: new RegExp(visitPath) });
  await expect(visitRow).toBeVisible();
  await expect(visitRow).toContainText("203.0.113.7");
  await prisma.statsVisitLog.deleteMany({ where: { path: visitPath } });
  await prisma.statsPageDaily.deleteMany({ where: { path: visitPath } });

  // hover 趋势图 → client 岛吸附出数据 tip(用户反馈补强)
  await page.locator("svg[aria-label='PV/UV 趋势图']").hover({ position: { x: 200, y: 100 } });
  await expect(page.getByTestId("trend-tip")).toBeVisible();
  await expect(page.getByTestId("trend-tip")).toContainText("PV");

  // 分段切换 URL 驱动:trend=30 生效且 hot 参数跨段保留
  // 「近 30 天」共 4 枚(Link 分段):趋势卡 + 热门页面/热门搜索(2026-10-06)/
  // 条目点击(M28)三张 hot 分段卡各一,count=4 证四卡分段均按参数渲染
  await page.goto("/admin/?trend=30&hot=all");
  await expect(page.getByRole("link", { name: "近 30 天" })).toHaveCount(4);
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
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);
  await page.goto("/admin/settings/pats/");
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
  await page.goto("/admin/settings/pats/");
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
  const MARK_PENDING = "e2e-telegram-pending";
  // 自播种:独立渠道(采集关闭)+ 一条可见电报(publishedAt=now 保证排进带首;重跑幂等;
  // M15 批① 起前台只出 AI 解读终态行,种子带 done+aiRanAt)+ 同源一条 pending
  // (解读在队列,不上屏)
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
  await prisma.telegram.deleteMany({
    where: { sourceId: source.id, title: { in: [MARK, MARK_PENDING] } },
  });
  await prisma.telegram.create({
    data: {
      sourceId: source.id,
      title: MARK,
      summary: "e2e 冒烟摘要",
      url: "https://e2e.invalid/item/1",
      publishedAt: new Date(),
      contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
      aiStatus: "done",
      aiSummary: "e2e 冒烟 AI 摘要",
      aiRanAt: new Date(),
    },
  });
  await prisma.telegram.create({
    data: {
      sourceId: source.id,
      title: MARK_PENDING,
      summary: "e2e 冒烟摘要(解读在队列)",
      url: "https://e2e.invalid/item/2",
      publishedAt: new Date(),
      contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
      aiStatus: "pending",
    },
  });
  // M15 批① 空态:独立渠道仅一条 pending → 该源 SSR 空列,展示「AI 解读处理中」提示
  const pendSource = await prisma.crawlSource.upsert({
    where: { name: "e2e-telegram-pending-source" },
    update: {},
    create: {
      name: "e2e-telegram-pending-source",
      type: "rss",
      url: "https://e2e.invalid/rss-pending",
      enabled: false,
      remark: "e2e 专用,采集关闭",
    },
  });
  await prisma.telegram.deleteMany({ where: { sourceId: pendSource.id } });
  await prisma.telegram.create({
    data: {
      sourceId: pendSource.id,
      title: "e2e-telegram-pending-only",
      summary: "e2e 空态冒烟摘要",
      url: "https://e2e.invalid/item/3",
      publishedAt: new Date(),
      contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
      aiStatus: "pending",
    },
  });

  try {
    // noindex 双保险:X-Robots-Tag 响应头 + 页内 robots meta;LIVE 头标与播种条目在;
    // pending 行(解读在队列)不上屏——html 与 API 均不可见(M15 批① 门禁)
    const feed = await request.get("/telegram/");
    expect(feed.status()).toBe(200);
    expect(feed.headers()["x-robots-tag"]).toBe("noindex, follow");
    const html = await feed.text();
    expect(html).toMatch(/name="robots" content="noindex[^"]*"/);
    expect(html).toContain("LIVE · 持续采集中");
    expect(html).toContain(MARK);
    // pending 行不上屏——按条目 URL 断言(标题串会与「仅 pending 渠道」的渠道
    // chip 名 e2e-telegram-pending-source 撞子串;渠道活性计数口径不随门禁收窄)
    expect(html).not.toContain("https://e2e.invalid/item/2");

    // 公共 API:no-store;出参 BigInt 已字符串化;today 含播种条目;pending 不出
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
    expect(body.data.items.find((i) => i.title === MARK_PENDING)).toBeUndefined();
    expect(body.data.today).toBeGreaterThan(0);

    // M15 批① 空态:仅 pending 的源 → 空列 + 「AI 解读处理中 · 今日已入库 N 条」
    const pendHtml = await (await request.get(`/telegram/?source=${pendSource.id}`)).text();
    expect(pendHtml).toContain("AI 解读处理中");
    expect(pendHtml).toContain("今日已入库");

    // 首页 LIVE 带壳在(SSR;条目轮询由 /telegram 页与 API 覆盖,首页 ISR 缓存不断言 MARK)
    const home = await (await request.get("/")).text();
    expect(home).toContain("tail -f /telegram");
    expect(home).toContain('href="/telegram/"');

    // SEO 红线:电报流不入 sitemap(显式页面清单)
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/telegram");
  } finally {
    await prisma.telegram.deleteMany({ where: { sourceId: { in: [source.id, pendSource.id] } } });
    await prisma.crawlSource.deleteMany({ where: { id: { in: [source.id, pendSource.id] } } });
  }
});

test("13. 电报流后台三页可见(M7:渠道台账/流治理/采集总览)", async ({ page }) => {
  // 登录(同前序用例 UI 流)
  await page.goto("/admin/login");
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);

  // 渠道台账:页头说明 + 新增入口
  await page.goto("/admin/spider/channels/");
  await expect(page.getByText("采集渠道台账")).toBeVisible();
  await expect(page.getByRole("button", { name: "新增渠道" })).toBeVisible();

  // 流治理:分段 tabs(带计数)+ 屏蔽词管理岛
  await page.goto("/admin/telegram/");
  await expect(page.getByRole("link", { name: /^全部 \d+$/ })).toBeVisible();
  await expect(page.getByText(/屏蔽词/).first()).toBeVisible();

  // 采集总览:tick 调度卡 + 队列实况(M9:interpreter 真实计数;M11 批②起 github 第三队列)
  await page.goto("/admin/spider/");
  await expect(page.getByRole("heading", { name: "采集总览" })).toBeVisible();
  await expect(page.getByText("tick 调度器", { exact: true })).toBeVisible();
  await expect(page.getByText("队列实况")).toBeVisible();
  await expect(page.getByText("interpreter", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/视频解读 · 下载 \/ 抽轨 \/ ASR \/ LLM · 并发 1 · 今日 \d+\/\d+/),
  ).toBeVisible();
  await expect(page.getByText(/日配额超限延迟 30min 重投/)).toBeVisible();
  await expect(page.getByText("github", { exact: true })).toBeVisible();
  await expect(page.getByText(/开源项目白名单同步 · \d+ 仓\(\d+ 调度中\)/)).toBeVisible();
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
  // M24:B站播种(平台行停用 + 纯数字 mid 博主 + 已解读视频行)——sec_uid 语义
  // per-platform,前台/后台平台链路与「B站」角标零适配器依赖,直接断言呈现
  const BILI_NICK = "e2e-B站博主";
  const BILI_MID = "12345678";
  const MARK_BILI = "e2e-B站视频-mark";
  const biliRow = await prisma.crawlSource.upsert({
    where: { name: "e2e-social:bilibili" },
    update: { enabled: false },
    create: {
      name: "e2e-social:bilibili",
      type: "social-video",
      platform: "bilibili",
      url: "https://e2e.invalid/bilibili",
      enabled: false,
      remark: "e2e 专用",
    },
  });
  await prisma.socialAccount.deleteMany({ where: { secUid: BILI_MID } });
  await prisma.socialAccount.create({
    data: {
      platformRowId: biliRow.id,
      platform: "bilibili",
      secUid: BILI_MID,
      nickname: BILI_NICK,
      category: "AI 资讯",
    },
  });
  await prisma.telegram.deleteMany({ where: { sourceId: biliRow.id, title: MARK_BILI } });
  await prisma.telegram.create({
    data: {
      sourceId: biliRow.id,
      title: MARK_BILI,
      summary: "e2e B站视频卡冒烟",
      url: "https://www.bilibili.com/video/BV1e2e000001",
      publishedAt: new Date(),
      contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
      mediaType: "video",
      videoPlatform: "bilibili",
      videoBlogger: BILI_NICK,
      videoCoverUrl: "https://e2e.invalid/cover-bv1e2e.jpg",
      videoDuration: 305,
      videoEngagement: { play: 8000, like: 234, comment: 45 },
      aiStatus: "done",
      aiTopic: "e2e B站解读主题",
      aiSummary: "e2e B站解读摘要:该视频内容的概括文本。",
      aiPoints: ["要点一", "要点二"],
      aiRanAt: new Date(),
    },
  });

  try {
    // 登录(同前序用例 UI 流)
    await page.goto("/admin/login");
    await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
    await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await page.waitForURL(/\/admin\/?$/);

    // 台账页:双状态卡 + 播种行(平台行停用 → 健康列「平台已停用」徽标)
    await page.goto("/admin/discovery/bloggers/");
    await expect(page.getByRole("button", { name: "登记博主" })).toBeVisible();
    await expect(page.getByText("采集网关(douyin-gateway · 抖音/B站)")).toBeVisible();
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
      headers: { origin: originOf(page) },
    });
    expect(bf.status()).toBe(409); // 播种平台行停用 → disabled,零 worker 依赖

    // 两步武装删除·UI 侧(批③原型口径):启停移交「启用」列 StatusSwitch,
    // 启用中删除钮可点(2026-10-11 验收反馈:禁用无反馈改点击提示),武装判断在服务端
    const delBtn = row.getByRole("button", { name: "删除" });
    await expect(delBtn).toBeEnabled();
    await expect(delBtn).toHaveAttribute("title", "两步武装删除:先停用,再物理删除");
    await expect(row).toBeVisible();
    // 两步武装删除·服务端同判:session DELETE 直打启用中博主 → 409
    // (mutation 有 Origin 关:page.request 不自动带,须显式补同源 Origin,同 4.3b 注)
    const del = await page.request.delete(`/api/bloggers/${blogger.id}/`, {
      headers: { origin: originOf(page) },
    });
    expect(del.status()).toBe(409);

    // 停用(confirm 走 StatusSwitch disableHint)→ 开关翻 off;启用态专属按钮
    // (立即采集/回填)随之隐藏,删除钮解禁
    const sw = row.getByRole("switch", { name: `${NICK} 启用开关` });
    page.once("dialog", (d) => d.accept());
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false", { timeout: 10_000 });
    await expect(row.getByRole("button", { name: "回填" })).toBeHidden();
    await expect(row.getByRole("button", { name: "立即采集" })).toBeHidden();
    // 删除(confirm)→ 物理删,行消失
    await expect(delBtn).toBeEnabled();
    page.once("dialog", (d) => d.accept());
    await delBtn.click();
    await expect(row).toBeHidden({ timeout: 10_000 });
    expect(await prisma.socialAccount.count({ where: { secUid: SEC_UID } })).toBe(0);
    // 博主删除不影响已入库视频条目(video_blogger 冗余隔离,arch/02 §3.2)
    expect(
      await prisma.telegram.count({ where: { sourceId: platformRow.id, title: MARK_V } }),
    ).toBe(1);

    // M24 B站行:平台停用徽标 + 作品入口 space.bilibili.com/{mid}
    // (sec_uid 语义 per-platform,bilibili=纯数字 mid)
    const biliRowEl = page.getByRole("row", { name: new RegExp(BILI_NICK) });
    await expect(biliRowEl).toBeVisible();
    await expect(biliRowEl.getByText("平台已停用")).toBeVisible();
    await expect(biliRowEl.getByRole("link", { name: `打开 ${BILI_NICK} 的主页` })).toHaveAttribute(
      "href",
      `https://space.bilibili.com/${BILI_MID}`,
    );

    // 后台媒体筛选(批⑦):video 页含播种行(封面/原视频链/平台·博主),text 页不含
    await page.goto("/admin/telegram/?media=video");
    const vRow = page.getByRole("row", { name: new RegExp(MARK_V) });
    await expect(vRow).toBeVisible();
    await expect(vRow.getByRole("img", { name: MARK_V })).toBeVisible();
    await expect(vRow.getByRole("link", { name: /打开原视频/ })).toBeVisible();
    await expect(vRow.getByText(`抖音 · ${NICK}`)).toBeVisible();
    // M24:B站行同管道呈现(来源列「B站 · 博主」)
    const biliVRow = page.getByRole("row", { name: new RegExp(MARK_BILI) });
    await expect(biliVRow).toBeVisible();
    await expect(biliVRow.getByText(`B站 · ${BILI_NICK}`)).toBeVisible();
    // M9:已解读徽章 + 行内解读按钮在(不点击——真按会下载/转写入队);
    // M12 批⑥:done 行按钮为重生成语义「重解读」
    await expect(vRow.getByText("已解读")).toBeVisible();
    await expect(vRow.getByRole("button", { name: /^(重)?解读$/ })).toBeVisible();
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

    // 解读态筛选(M10 批⑤):done 命中播种行(aiStatus=done),none 不含
    await page.goto("/admin/telegram/?ai=done");
    await expect(page.getByRole("row", { name: new RegExp(MARK_V) })).toBeVisible();
    await page.goto("/admin/telegram/?ai=none");
    await expect(page.getByRole("row", { name: new RegExp(MARK_V) })).toHaveCount(0);

    // 前台 media 筛选:video 页含播种视频卡(平台·博主 chip),text 页不含;非法值回落 all
    const videoHtml = await (await request.get("/telegram/?media=video")).text();
    expect(videoHtml).toContain(MARK_V);
    expect(videoHtml).toContain(`抖音 · ${NICK}`);
    expect(videoHtml).toContain(MARK_BILI); // M24:B站条同管道
    expect(videoHtml).toContain(`B站 · ${BILI_NICK}`);
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

    // M24:B站视频卡(「B站」平台角标 + 时长角标),同一卡片形态零适配分支
    const biliCard = page.getByRole("article").filter({ hasText: MARK_BILI });
    await expect(biliCard.getByRole("heading", { name: MARK_BILI })).toBeVisible();
    await expect(biliCard.getByRole("link", { name: /打开原视频/ })).toBeVisible();
    await expect(biliCard.getByText("B站", { exact: true })).toBeVisible();
    await expect(biliCard.getByText("5:05", { exact: true })).toBeVisible(); // 305s
    await expect(biliCard.getByText("8000", { exact: true })).toBeVisible(); // 播放(未过万直出)
    await expect(biliCard.getByText("AI 解读")).toBeVisible();

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
    // M24:B站条投影(平台字段如实透出)
    const biliHit = bv.data.items.find((i) => i.title === MARK_BILI);
    expect(biliHit).toBeTruthy();
    expect(biliHit!.mediaType).toBe("video");
    expect(biliHit!.video).toMatchObject({
      platform: "bilibili",
      blogger: BILI_NICK,
      durationSeconds: 305,
    });
    // M9:公共 API 投影带 ai 解读结论(白名单三字段)
    expect(hit!.video!.ai).toEqual({
      topic: AI_TOPIC,
      summary: AI_SUMMARY,
      points: AI_POINTS,
      keywords: null,
    });
    const bt = (await (await request.get("/api/telegram/public/?media=text&limit=50")).json()) as {
      data: { items: Array<{ title: string }> };
    };
    expect(bt.data.items.find((i) => i.title === MARK_V)).toBeUndefined();
  } finally {
    await prisma.socialAccount.deleteMany({ where: { secUid: SEC_UID } });
    await prisma.telegram.deleteMany({ where: { sourceId: platformRow.id } });
    await prisma.crawlSource.deleteMany({ where: { name: "e2e-social:douyin" } });
    // M24:B站播种清理
    await prisma.socialAccount.deleteMany({ where: { secUid: BILI_MID } });
    await prisma.telegram.deleteMany({ where: { sourceId: biliRow.id } });
    await prisma.crawlSource.deleteMany({ where: { name: "e2e-social:bilibili" } });
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
    await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
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
    // (只写 dailyMax,主/备用引用原样带回,不动真实绑定)。
    // M15 批②:配额输入按消费方出现——interpret/summarize 卡有(各自独立配置);
    // K1/K2 起 search 有消费方(答案路由)同样可配;cover 仍无消费方不渲染
    const interpretCard = page.getByRole("group", { name: "电报解读绑定" });
    await expect(interpretCard.getByLabel("电报解读日配额")).toBeVisible();
    await expect(sumCard.getByLabel("文字摘要日配额")).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Agent 搜索绑定" }).getByLabel(/日配额/),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "封面生图绑定" }).getByLabel(/日配额/),
    ).toHaveCount(0);
    const beforeQuota = await prisma.aiTaskBinding.findUniqueOrThrow({
      where: { role: "interpret" },
    });
    const quotaPut = await page.request.put("/api/model-bindings", {
      headers: jsonOrigin(page),
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
      headers: jsonOrigin(page),
      data: {
        role: "interpret",
        primaryId: beforeQuota.primaryId,
        backupId: beforeQuota.backupId,
        dailyMax: beforeQuota.dailyMax,
      },
    });

    // 服务端绑定校验:purposes 不匹配 → 400;主备同模型 → 400(mutation 带 Origin,同 14)
    const badPurpose = await page.request.put("/api/model-bindings", {
      headers: jsonOrigin(page),
      data: { role: "search", primaryId: base.id, backupId: null },
    });
    expect(badPurpose.status()).toBe(400);
    expect(((await badPurpose.json()) as { message: string }).message).toContain("用途");
    const badSame = await page.request.put("/api/model-bindings", {
      headers: jsonOrigin(page),
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
  // 回归哨兵(2026-10-04):重载断言后等水合落地复查主题仍在。
  // 修复前:电报流相对时间 SSR/水合时钟不一致 → React #418 整树回退重渲染,
  // 把脚本预置的 html[data-theme] 灌回 light(用户实测「刷新又变 Light」)。
  // 不用 waitForLoadState("networkidle"):首页外链封面图经代理长挂,网络永不静默
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.waitForTimeout(1_500); // 本地 prod 构建水合 << 1s,足够回退显形
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(pageErrors).toEqual([]);

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

test("17. 首页带条数可配置(2026-10-05 统筹改版对齐:site_config/设置页/带内固定一页/保底视频)", async ({
  page,
}) => {
  // 自播种:独立渠道 + 15 条可见文字电报(> 默认 12;publishedAt 逐分钟递减保证确定性排序;
  // 带内已改固定一页,15 条只为验证「只取前 N、不随滚动增长」;
  // M15 批① 起前台只出 AI 解读终态行,种子逐行带 done+aiRanAt)
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
      aiStatus: "done",
      aiSummary: `e2e 带条目 AI 摘要 ${i}`,
      aiRanAt: new Date(Date.now() - i * 60_000),
    })),
  });
  // 视频行(最新 +1min → 必赢全库保底槽位;共享库里有真实爬取视频,
  // 种子必须比它们新,否则保底槽被真实视频占据,计数断言随数据漂移):
  await prisma.telegram.create({
    data: {
      sourceId: source.id,
      title: "e2e-band-video",
      summary: "e2e 带视频条目",
      url: "https://e2e.invalid/bandv/1",
      publishedAt: new Date(Date.now() + 60_000),
      contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
      mediaType: "video",
      videoPlatform: "douyin",
      videoBlogger: "e2e 带博主",
      // 1×1 GIF data-url:img 可成功解码渲染(外链 404 会触发 onError 降级占位块)
      videoCoverUrl:
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      videoDuration: 91,
      videoEngagement: { play: 12000, like: 34, comment: 5 },
      aiStatus: "done",
      aiTopic: "e2e 带视频 AI 主题",
      aiSummary: "e2e 带视频 AI 摘要",
      aiPoints: [],
      aiRanAt: new Date(),
    },
  });
  // 记住原配置(行缺=null)测后还原
  const original = await prisma.siteConfig.findUnique({ where: { key: "band.item_count" } });
  // 无尾斜杠:视频行 URL bandv/1 同属 band 前缀,计数含保底视频槽
  const rows = page.locator("a[href^='https://e2e.invalid/band']");

  try {
    // admin 登录 → 设置页:初值=默认 12,改成 3 保存
    await page.goto("/admin/login");
    await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
    await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await page.waitForURL(/\/admin\/?$/);
    await page.goto("/admin/settings/");
    const input = page.getByLabel("首页电报流条数");
    await expect(input).toHaveValue("12");
    await input.fill("3");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("已保存,首页即时再生")).toBeVisible();

    // 落库 + GET API 回读;revalidatePath 后首页 SSR 立即 3 行。
    // 首屏计数用 evaluate 原子快照(视频保底槽位会替换首屏末位,文字行可为 2)
    expect(
      (await prisma.siteConfig.findUniqueOrThrow({ where: { key: "band.item_count" } })).value,
    ).toBe("3");
    const cfg = await page.request.get("/api/site-config");
    expect(((await cfg.json()) as { data: { bandItemCount: number } }).data.bandItemCount).toBe(3);
    await page.goto("/");
    expect(
      await page.evaluate(
        () => document.querySelectorAll("a[href^='https://e2e.invalid/band']").length,
      ),
    ).toBe(3);

    // 带内固定一页(2026-10-05 统筹改版:下滚自动加载已移除):滚动不增长,
    // 完整流与历史翻页走「进入电报流 →」;保底视频占一槽
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(400);
    await expect(rows).toHaveCount(3);
    await expect(page.getByText("— 已加载全部 —")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "进入电报流 →" })).toBeVisible();

    // 视频行结构(M10 批③ 带内原型重排):54×95 封面 + 平台章/博主 + 时长条 + AI 概括行
    const vRow = page.locator("a[href='https://e2e.invalid/bandv/1']");
    await expect(vRow).toBeVisible();
    await expect(vRow.locator("img")).toBeVisible();
    // 平台章/博主有 sm+ 与窄屏两份响应式副本,取首份断言
    await expect(vRow.getByText("抖音", { exact: true }).first()).toBeVisible();
    await expect(vRow.getByText("@e2e 带博主").first()).toBeVisible();
    await expect(vRow.getByText("1:31")).toBeVisible();
    // 批⑤:band 视频行 AI 行直出 summary(topic 恒泛化词不再上带)
    await expect(vRow.getByText(/AI 解读 · e2e 带视频 AI 摘要/)).toBeVisible();
  } finally {
    // 还原:回写原值(原无行 → 写默认 12 后删行),清播种数据
    const origin = jsonOrigin(page);
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

test("18. GitHub 项目展示(M11:首页卡/列表/详情 README 重写与时间轴/下架即 404/admin 武装删除)", async ({
  page,
  request,
}) => {
  const SLUG = "e2e-demo-repo";
  const FULL_NAME = "domonic18/e2e-demo-repo";
  // 自播种零网络:登记行 readme 含代码栅栏/相对图/相对链/绝对图;nextSyncAt 推远防 worker 抢跑
  const README = [
    "# e2e-demo-repo",
    "",
    "安装:`npm i -g e2e-demo`。",
    "",
    "![架构图](docs/arch.png)",
    "",
    "![外链图](https://example.com/e2e-abs.png)",
    "",
    "[使用指南](./GUIDE.md)",
    "",
    "```bash",
    'echo "hello e2e"',
    "```",
    "",
  ].join("\n");
  await prisma.githubRepo.deleteMany({ where: { slug: SLUG } });
  const repo = await prisma.githubRepo.create({
    data: {
      fullName: FULL_NAME,
      slug: SLUG,
      description: "e2e 演示仓库:同步管道与前台三件套冒烟",
      stars: 1234,
      forks: 21,
      language: "TypeScript",
      topics: ["e2e", "cli"],
      htmlUrl: `https://github.com/${FULL_NAME}`,
      homepage: "https://e2e.invalid/home",
      defaultBranch: "main",
      readmeMd: README,
      nextSyncAt: new Date(Date.now() + 24 * 3600_000), // 推远:worker 不抢跑,「立即同步」可见但不可点
    },
  });
  const now = Date.now();
  await prisma.githubRepoActivity.createMany({
    data: [
      // occurredAt 倒序断言用:release 最新,两条 commit 依次更旧
      {
        repoId: repo.id,
        kind: "release",
        externalId: "1001",
        title: "e2e release v1.0.0",
        url: `https://github.com/${FULL_NAME}/releases/tag/v1.0.0`,
        author: "domonic18",
        occurredAt: new Date(now - 10 * 60_000),
      },
      {
        repoId: repo.id,
        kind: "commit",
        externalId: "abc0000001",
        title: "e2e commit 甲:初始提交",
        url: `https://github.com/${FULL_NAME}/commit/abc0000001`,
        author: "domonic18",
        occurredAt: new Date(now - 60 * 60_000),
      },
      {
        repoId: repo.id,
        kind: "commit",
        externalId: "abc0000002",
        title: "e2e commit 乙:修复",
        url: `https://github.com/${FULL_NAME}/commit/abc0000002`,
        author: "domonic18",
        occurredAt: new Date(now - 120 * 60_000),
      },
    ],
  });
  // 配套文章关联既有已发布文(154+ 篇必在;测试尾解除关联,post 本体不动)
  const linkedPost = await prisma.post.findFirst({
    where: { status: "published" },
    orderBy: { publishedAt: "desc" },
    select: { id: true, slug: true, title: true },
  });
  expect(linkedPost).toBeTruthy();
  await prisma.githubRepoPost.create({ data: { repoId: repo.id, postId: linkedPost!.id } });

  try {
    // 登录 admin,经 update API 触发 admin 写侧 revalidateProjectPaths(直插 prisma 不失效 ISR)
    await page.goto("/admin/login");
    await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
    await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await page.waitForURL(/\/admin\/?$/);
    // Origin 头取运行时站点源(mutation 同源关;e2e 可能起在 :3100 备用端口)
    const origin = jsonOrigin(page);
    const nudged = await page.request.put(`/api/github/repos/${repo.id}/`, {
      headers: origin,
      data: { syncIntervalMin: 60, sortOrder: 0 },
    });
    expect(nudged.status()).toBe(200);

    // 首页右栏「开源项目」卡:仓库名 + /projects/ 链接 + 1.2k 星口径
    const homeHtml = await (await request.get("/")).text();
    expect(homeHtml).toContain(FULL_NAME);
    expect(homeHtml).toContain(`/projects/${SLUG}/`);
    expect(homeHtml).toContain("1.2k");
    expect(homeHtml).toContain("配套文章 ×1");

    // /projects/ 列表:终端风头 + 仓库卡
    const listHtml = await (await request.get("/projects/")).text();
    expect(listHtml).toContain("ls -la /projects"); // $ 是独立 span,不断言拼接字面量
    expect(listHtml).toContain(FULL_NAME);

    // 详情:README 相对图重写 raw.githubusercontent、相对链重写 blob、绝对图透传、
    // 代码高亮、时间轴 release→commit 归并倒序、配套文章、JSON-LD
    const detailRes = await request.get(`/projects/${SLUG}/`);
    expect(detailRes.status()).toBe(200);
    const detailHtml = await detailRes.text();
    expect(detailHtml).toContain(
      `https://raw.githubusercontent.com/${FULL_NAME}/main/docs/arch.png`,
    );
    expect(detailHtml).toContain("https://example.com/e2e-abs.png");
    expect(detailHtml).toContain(`https://github.com/${FULL_NAME}/blob/main/GUIDE.md`);
    expect(detailHtml).toContain("hello e2e");
    expect(detailHtml).toContain("hljs");
    expect(detailHtml).toContain('rel="noopener noreferrer nofollow"');
    expect(detailHtml.indexOf("e2e release v1.0.0")).toBeLessThan(
      detailHtml.indexOf("e2e commit 甲:初始提交"),
    );
    expect(detailHtml.indexOf("e2e commit 甲:初始提交")).toBeLessThan(
      detailHtml.indexOf("e2e commit 乙:修复"),
    );
    const postHref = `/post/${linkedPost!.id}${linkedPost!.slug ? `-${linkedPost!.slug}` : ""}/`;
    expect(detailHtml).toContain(`href="${postHref}"`);
    expect(detailHtml).toContain("SoftwareSourceCode");

    // SEO 面:sitemap 收录;错 slug 直接 404 不归一(无 id 锚点);守卫外形态(大写/下划线)同 404
    const sitemapHtml = await (await request.get("/sitemap.xml")).text();
    expect(sitemapHtml).toContain(`/projects/${SLUG}/`);
    expect((await request.get("/projects/e2e-no-such-repo/")).status()).toBe(404);
    expect((await request.get("/projects/E2E_Demo/")).status()).toBe(404);

    // admin 台账:播种行可见,「立即同步」在(不点击——真按会经 worker 出网)
    await page.goto("/admin/discovery/github/");
    const row = page.getByRole("row", { name: new RegExp(SLUG) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "立即同步" })).toBeVisible();

    // 武装删除·服务端:enabled 启用中 DELETE → 409
    const del = await page.request.delete(`/api/github/repos/${repo.id}/`, {
      headers: { origin: originOf(page) },
    });
    expect(del.status()).toBe(409);

    // 下架即 404(admin 写侧即时 revalidate)→ 重新上架恢复 200
    await page.request.put(`/api/github/repos/${repo.id}/status/`, {
      headers: origin,
      data: { display: false },
    });
    expect((await request.get(`/projects/${SLUG}/`)).status()).toBe(404);
    await page.request.put(`/api/github/repos/${repo.id}/status/`, {
      headers: origin,
      data: { display: true },
    });
    expect((await request.get(`/projects/${SLUG}/`)).status()).toBe(200);
  } finally {
    await prisma.githubRepo.deleteMany({ where: { slug: SLUG } });
  }
});

test("19. M12 收口:站点设置扩展/文章视图切换与 tag 筛选/菜单精简/带文字行 AI 轻解读", async ({
  page,
  request,
}) => {
  const AI_ROW_READ = "https://e2e.invalid/ai/1";
  const AI_ROW_RAW = "https://e2e.invalid/ai/2";
  const SLUG_A = "e2e-rail-a";
  const SLUG_B = "e2e-rail-b";
  const TAG_SLUG = "e2e-tag-jia";
  const SITE_TITLE = "e2e站点甲";
  const HERO_MD = "e2e **hub文案** 主标题甲";
  const CONFIG_KEYS = [
    "band.item_count",
    "home.repo_count",
    "home.post_count",
    "site.title",
    "home.hero_md",
  ];

  // ── 播种①:band 文字行两条(已解读 ai_* 有值 / 无解读对照),publishedAt=now 保证进带首
  //    批⑥ 新契约:ai_points=要点、ai_keywords=关键词;
  //    M15 批① 起前台只出 AI 解读终态行——对照行改为「终态但无解读产出」
  //    (aiStatus=done 无 aiSummary → 投影 ai=null):行可见、无 AI 行,对照语义保留
  const source = await prisma.crawlSource.upsert({
    where: { name: "e2e-ai-band-source" },
    update: {},
    create: {
      name: "e2e-ai-band-source",
      type: "rss",
      url: "https://e2e.invalid/ai-rss",
      enabled: false,
      remark: "e2e 专用,采集关闭",
    },
  });
  await prisma.telegram.deleteMany({ where: { sourceId: source.id } });
  await prisma.telegram.createMany({
    data: [
      {
        sourceId: source.id,
        title: "e2e-ai-已解读",
        summary: "e2e 轻解读摘要",
        url: AI_ROW_READ,
        publishedAt: new Date(),
        contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
        aiStatus: "done",
        aiSummary: "e2e 中心思想一句话",
        aiPoints: ["要点甲", "要点乙"],
        aiKeywords: ["关键词甲", "关键词乙", "关键词丙"],
        aiRanAt: new Date(),
      },
      {
        sourceId: source.id,
        title: "e2e-ai-未解读",
        summary: "e2e 对照摘要",
        url: AI_ROW_RAW,
        publishedAt: new Date(Date.now() - 60_000),
        contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
        aiStatus: "done",
        aiRanAt: new Date(Date.now() - 60_000),
      },
    ],
  });
  const seeded = await prisma.telegram.findMany({
    where: { sourceId: source.id },
    select: { id: true, title: true },
  });
  const aiReadId = seeded.find((r) => r.title === "e2e-ai-已解读")!.id.toString();

  // ── 播种②:两个 showcase 仓库。rail 排序=sortOrder 升序、平手 stars 降序
  //    (listShowcaseRepos):与存量最小 sortOrder 并列 + stars 垫到全场最高,
  //    A 恒第一、B 第二,与库态无关;repo_count=1 钳制只现 A。
  //    nextSyncAt 推远防 worker 抢跑
  await prisma.githubRepo.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
  const minSort =
    (await prisma.githubRepo.aggregate({ _min: { sortOrder: true } }))._min.sortOrder ?? 0;
  const maxStars = (await prisma.githubRepo.aggregate({ _max: { stars: true } }))._max.stars ?? 0;
  await prisma.githubRepo.createMany({
    data: [SLUG_A, SLUG_B].map((slug, i) => ({
      fullName: `e2e-rail/${slug}`,
      slug,
      description: `e2e rail ${slug}`,
      stars: maxStars + 1000 - i,
      htmlUrl: `https://github.com/e2e-rail/${slug}`,
      sortOrder: minSort,
      nextSyncAt: new Date(Date.now() + 24 * 3600_000),
    })),
  });

  // ── 播种③:tag 挂到既有已发布文(154+ 篇必在;filter-bar 与 tag 路由闭环用)
  const linkedPost = await prisma.post.findFirst({
    where: { status: "published" },
    orderBy: { publishedAt: "desc" },
    select: { id: true, title: true },
  });
  expect(linkedPost).toBeTruthy();
  const tag = await prisma.tag.upsert({
    where: { slug: TAG_SLUG },
    update: {},
    create: { slug: TAG_SLUG, name: "e2e标签甲" },
  });
  await prisma.postTag.deleteMany({ where: { tagId: tag.id } });
  await prisma.postTag.create({ data: { postId: linkedPost!.id, tagId: tag.id } });

  // ── 记录原五键(行缺=null,finally 按行有/无回写或删除)
  const originals = await prisma.siteConfig.findMany({
    where: { key: { in: CONFIG_KEYS } },
  });

  try {
    // ── admin 登录 → 设置页:项目卡 1 / 文章 2 / 站点标题 / hero_md,保存
    await page.goto("/admin/login");
    await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
    await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await page.waitForURL(/\/admin\/?$/);
    await page.goto("/admin/settings/");
    await page.getByLabel("首页项目卡条数").fill("1");
    await page.getByLabel("首页博主文章条数").fill("2");
    await page.getByLabel("站点标题").fill(SITE_TITLE);
    await page.getByLabel("首页 Hub 主文案").fill(HERO_MD);
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("已保存,首页即时再生")).toBeVisible();

    // 落库 + GET API 回读
    const saved = await prisma.siteConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    const val = (key: string): string => saved.find((r) => r.key === key)!.value;
    expect(val("home.repo_count")).toBe("1");
    expect(val("home.post_count")).toBe("2");
    expect(val("site.title")).toBe(SITE_TITLE);
    expect(val("home.hero_md")).toBe(HERO_MD);
    const cfg = await page.request.get("/api/site-config");
    expect(
      (await cfg.json()) as { data: { repoCount: number; postCount: number; siteTitle: string } },
    ).toMatchObject({ data: { repoCount: 1, postCount: 2, siteTitle: SITE_TITLE } });

    // ── 首页(保存即再生):title/顶栏站名、主菜单无 归档/关于、hero_md 行内 markdown
    await page.goto("/");
    await expect(page).toHaveTitle(new RegExp(SITE_TITLE));
    await expect(page.locator("header").getByText(SITE_TITLE)).toBeVisible();
    await expect(page.locator("header nav a", { hasText: "归档" })).toHaveCount(0);
    await expect(page.locator("header nav a", { hasText: "关于" })).toHaveCount(0);
    await expect(page.locator("h1 strong", { hasText: "hub文案" })).toBeVisible();

    // rail 计数受配置钳制:项目卡仅现 sortOrder 最小的 A;文章 2 条
    await expect(page.locator("a[href^='/projects/']:not([href='/projects/'])")).toHaveCount(1);
    await expect(page.getByText(`e2e-rail/${SLUG_A}`)).toBeVisible();
    await expect(page.getByText(`e2e-rail/${SLUG_B}`)).toHaveCount(0);
    await expect(page.locator("a[href^='/post/']")).toHaveCount(2);

    // band 文字 AI 行:已解读 → 「AI 解读 · 中心思想 + #关键词(蓝系)」;未解读对照 → 无 AI 行
    // (2026-10-05 统筹改版:标识统一「AI 解读」,与视频行/电报流页同款)
    const readRow = page.locator(`a[href='${AI_ROW_READ}']`);
    await expect(readRow).toBeVisible();
    await expect(readRow.getByText(/AI 解读 · e2e 中心思想一句话/)).toBeVisible();
    await expect(readRow.getByText("#关键词甲")).toBeVisible();
    const rawRow = page.locator(`a[href='${AI_ROW_RAW}']`);
    await expect(rawRow).toBeVisible();
    await expect(rawRow.getByText(/AI 解读 · /)).toHaveCount(0);

    // 公开 API 投影(批⑥ 契约):要点/关键词双列;未解读行 ai null
    const pub = await request.get("/api/telegram/public/?limit=50");
    const pubBody = (await pub.json()) as {
      code: number;
      data: { items: Array<{ id: string; ai: Record<string, unknown> | null }> };
    };
    expect(pubBody.code).toBe(0);
    const pubRead = pubBody.data.items.find((i) => i.id === aiReadId);
    expect(pubRead?.ai).toEqual({
      topic: "",
      summary: "e2e 中心思想一句话",
      points: ["要点甲", "要点乙"],
      keywords: ["关键词甲", "关键词乙", "关键词丙"],
    });

    // /telegram 时间轴文字卡:要点折叠列表(批⑥ 问题3)+ 关键词 chips(蓝系,问题5)
    await page.goto("/telegram/");
    const aiCard = page.locator("article", { hasText: "e2e-ai-已解读" });
    await expect(aiCard.getByText("关键要点 ×2")).toBeVisible();
    await expect(aiCard.locator("summary", { hasText: "关键要点" })).toBeVisible();
    await expect(aiCard.getByText("#关键词甲")).toBeVisible();

    // 机器订阅源标题同步(feed.xml,保存时 layout 型 revalidate)
    expect(await (await request.get("/feed.xml")).text()).toContain(SITE_TITLE);

    // ── /articles/:tag 筛选条(全部 + 新 tag 链)→ tag 路由过滤闭环
    await page.goto("/articles/");
    const bar = page.locator("nav[aria-label='按标签筛选']");
    await expect(bar).toBeVisible();
    const tagLink = bar.getByRole("link", { name: /e2e标签甲/ });
    await expect(tagLink).toHaveAttribute("href", `/tag/${TAG_SLUG}/`);
    await tagLink.click();
    await expect(page).toHaveURL(new RegExp(`/tag/${TAG_SLUG}/`));
    expect(await page.content()).toContain(linkedPost!.title);

    // ── 视图切换(新 context 默认列表):卡片按钮翻转 + 列表隐而未卸 + localStorage 记忆
    await page.goto("/articles/");
    const cardsBtn = page.getByTitle("卡片视图");
    await expect(cardsBtn).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("article h2").first()).toBeVisible(); // 列表形态:h2 标题卡
    await expect(page.locator("article div.p-4").first()).toBeHidden(); // 卡片形态藏
    await cardsBtn.click();
    await expect(cardsBtn).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("article div.p-4").first()).toBeVisible(); // 封面卡
    await expect(page.locator("article h2").first()).toBeHidden();
    await page.reload(); // localStorage 恢复卡片视图
    await expect(page.getByTitle("卡片视图")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("article div.p-4").first()).toBeVisible();
  } finally {
    // 还原五键:原有行回写原值(经 API 走同款 revalidate);原无行删行
    const restore: Record<string, number | string> = {};
    const drop: string[] = [];
    for (const key of CONFIG_KEYS) {
      const row = originals.find((r) => r.key === key);
      if (!row) {
        drop.push(key);
        continue;
      }
      if (key === "band.item_count") restore["bandItemCount"] = Number(row.value);
      else if (key === "home.repo_count") restore["repoCount"] = Number(row.value);
      else if (key === "home.post_count") restore["postCount"] = Number(row.value);
      else if (key === "site.title") restore["siteTitle"] = row.value;
      else restore["heroMd"] = row.value;
    }
    if (Object.keys(restore).length > 0) {
      await page.request.put("/api/site-config", {
        headers: jsonOrigin(page),
        data: restore,
      });
    }
    if (drop.length > 0) {
      await prisma.siteConfig.deleteMany({ where: { key: { in: drop } } });
    }
    // 清播种
    await prisma.postTag.deleteMany({ where: { tagId: tag.id } });
    await prisma.tag.delete({ where: { id: tag.id } });
    await prisma.githubRepo.deleteMany({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
    await prisma.telegram.deleteMany({ where: { sourceId: source.id } });
    await prisma.crawlSource.delete({ where: { id: source.id } });
  }
});

test("20. M13 移动端走查:壳层抽屉/表格横滚/弹层不溢出/设置全宽/编辑器单栏(375×812)", async ({
  page,
}) => {
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

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin/login");
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);

  // 20.1 壳层抽屉:窄屏侧栏离屏(-translate-x-full,勿用 toBeHidden——离屏仍"可见");
  //     hamburger 呼出 → Esc 关 → 重开点导航,路由切换自闭
  const sidebar = page.locator("aside.border-r");
  await expect(sidebar).not.toBeInViewport();
  const menuBtn = page.getByRole("button", { name: "打开菜单" });
  await menuBtn.click();
  await expect(sidebar).toBeInViewport();
  await expect(page.getByRole("button", { name: "关闭菜单" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sidebar).not.toBeInViewport();
  await menuBtn.click();
  await expect(sidebar).toBeInViewport();
  await page.getByRole("link", { name: "电报管理" }).click();
  await page.waitForURL(/\/admin\/telegram/);
  await expect(sidebar).not.toBeInViewport();

  // 20.2 表格横滚:三张代表表(电报/文章/模型最宽表)wrapper scrollWidth > clientWidth
  for (const path of ["/admin/telegram/", "/admin/posts/", "/admin/models/"]) {
    await page.goto(path);
    const wrap = page.locator("div.overflow-x-auto").filter({ has: page.locator("table") });
    await expect(wrap.first()).toBeVisible();
    const scrollable = await wrap
      .first()
      .evaluate((el) => el.scrollWidth > el.clientWidth && el.clientWidth <= 375);
    expect(scrollable, `${path} 表格应横向滚动且容器不超视口`).toBe(true);
  }

  // 20.3 模型新增弹层(DialogShell)不溢出视口:面板右缘 ≤ 375(遮罩 p-4 + w-full 流式)
  await page.goto("/admin/models/");
  await page.getByRole("button", { name: "+ 新增模型" }).click();
  const panel = page.getByRole("heading", { name: "新增模型" }).locator("..");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(376); // 1px 容差
  await page.getByRole("button", { name: "取消" }).click();
  await expect(panel).toBeHidden();

  // 20.4 站点设置:站点标题输入窄屏全宽(w-full sm:w-64)
  await page.goto("/admin/settings/");
  const input = page.getByLabel("站点标题");
  await expect(input).toBeVisible();
  expect((await input.boundingBox())!.width).toBeGreaterThan(300);

  // 20.5 文章编辑器窄屏降级:ir 单栏模式在(非桌面 sv),元信息面板堆叠于编辑器下方
  await page.goto("/admin/posts/new");
  await expect(page.locator(".vditor-ir").first()).toBeVisible();
  const editorBox = await page.locator(".vditor").first().boundingBox();
  const metaBox = await page.locator("#post-category").boundingBox();
  expect(editorBox).not.toBeNull();
  expect(metaBox).not.toBeNull();
  expect(metaBox!.y).toBeGreaterThan(editorBox!.y + editorBox!.height);
});

test("21. M14 收口:用量统计看板(台账聚合/费用折算/降级拆分/90 天清理)+ 牌价配置 + 封面工作流冒烟", async ({
  page,
}) => {
  const MODEL_KEY = "e2e-usage-llm";
  const ASR_KEY = "e2e-usage-asr";
  // 自播种:带牌价模型(¥2 in / ¥8 out / ¥0.5 每张)+ 用量四行(LLM/ASR ok/ASR 降级/生图)
  // 期望账目:tokens 2.0M;费用 ¥7.00(LLM) + ¥5.00(ASR 0.5h×¥10) + ¥0.50(生图) = ¥12.50
  // 看板 KPI 是全表窗口聚合:回灌库带真实用量行(窗口内)会污染 ¥12.50/2.0M——
  // 测前快照非 e2e 行并清场,finally 原样回灌(id 不复原,断言不依赖;本地无并发写)
  const externalUsage = await prisma.aiUsageLog.findMany({
    where: { modelKey: { not: { startsWith: "e2e-usage" } } },
  });
  await prisma.aiUsageLog.deleteMany({
    where: { modelKey: { not: { startsWith: "e2e-usage" } } },
  });
  await prisma.aiUsageLog.deleteMany({ where: { modelKey: { startsWith: "e2e-usage" } } });
  await prisma.aiModel.deleteMany({ where: { modelId: MODEL_KEY } });
  const model = await prisma.aiModel.create({
    data: {
      name: "e2e-用量模型",
      provider: "DeepSeek",
      protocol: "openai",
      baseUrl: "https://e2e.invalid/v1",
      modelId: MODEL_KEY,
      purposes: ["summarize", "cover"],
      priceIn: 2,
      priceOut: 8,
      pricePerImage: 0.5,
    },
  });
  // ASR 单例牌价暂改(页脚口径:读时现折);记原值 finally 还原
  const asrBefore = await prisma.asrConfig.findUnique({ where: { id: 1 } });
  await prisma.asrConfig.upsert({
    where: { id: 1 },
    update: { pricePerHour: 10 },
    create: { id: 1, provider: "e2e", protocol: "openai", modelId: "e2e-asr", pricePerHour: 10 },
  });
  await prisma.aiUsageLog.createMany({
    data: [
      {
        role: "interpret",
        modelId: model.id,
        modelKey: MODEL_KEY,
        tokensIn: 1_500_000,
        tokensOut: 500_000,
        durationMs: 800,
      },
      { role: "asr", modelKey: ASR_KEY, audioSeconds: 1800, durationMs: 5000 },
      { role: "asr", modelKey: ASR_KEY, audioSeconds: 60, status: "degraded" },
      { role: "cover", modelId: model.id, modelKey: MODEL_KEY, durationMs: 12_000 },
    ],
  });
  // 91 天前的旧行:90 天保留期手动清理的靶子
  await prisma.aiUsageLog.create({
    data: {
      role: "summarize",
      modelId: model.id,
      modelKey: MODEL_KEY,
      tokensIn: 1000,
      createdAt: new Date(Date.now() - 91 * 86_400_000),
    },
  });

  try {
    await page.goto("/admin/login");
    await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
    await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await page.waitForURL(/\/admin\/?$/);

    // 21.1 侧栏入口进看板(批⑦启用;侧栏精简批② 起项名「AI 用量」):KPI 四卡 + 趋势 + 双分布 + 明细
    await page.goto("/admin/");
    await page.getByRole("link", { name: "AI 用量" }).click();
    await page.waitForURL(/\/admin\/usage/);
    await expect(page.getByText("Tokens 消耗")).toBeVisible();
    await expect(page.getByText("2.0M").first()).toBeVisible();
    await expect(page.getByText("¥12.50").first()).toBeVisible();
    await expect(page.getByText(/¥5\.00 · 1 个音频/)).toBeVisible(); // ASR KPI:降级行不计个数
    await expect(page.getByText("ASR 1 · LLM 0")).toBeVisible(); // 降级拆分
    await expect(page.getByText("日消耗趋势")).toBeVisible();
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
    await expect(page.getByText(today).first()).toBeVisible(); // 趋势 x 轴含今日
    await expect(page.getByText("按任务分布")).toBeVisible();
    await expect(page.getByText("按模型分布")).toBeVisible();

    // 明细三行:LLM(2.0M/¥7.00)/ ASR(调用 2 · 费用只算成功行 ¥5.00)/ 生图(¥0.50)
    const llmRow = page
      .getByRole("row", { name: new RegExp(MODEL_KEY) })
      .filter({ hasText: "电报解读" });
    await expect(llmRow).toContainText("2.0M");
    await expect(llmRow).toContainText("¥7.00");
    const asrRow = page.getByRole("row", { name: new RegExp(ASR_KEY) });
    await expect(asrRow).toContainText("ASR 转写");
    await expect(asrRow).toContainText("¥5.00");
    const coverRow = page
      .getByRole("row", { name: new RegExp(MODEL_KEY) })
      .filter({ hasText: "封面生图" });
    await expect(coverRow).toContainText("¥0.50");

    // 21.2 窗口切换(链接分段):days=7 仍含今日行
    await page.getByRole("link", { name: "近 7 天" }).click();
    await expect(page).toHaveURL(/days=7/);
    await expect(page.getByText("Tokens 消耗")).toBeVisible();

    // 21.3 90 天保留期手动清理:旧行被删,窗口内行保留
    const before = await prisma.aiUsageLog.count({
      where: { modelKey: { startsWith: "e2e-usage" } },
    });
    expect(before).toBe(5);
    const purge = await page.request.post("/api/usage/purge/", {
      headers: { origin: originOf(page) },
    });
    expect(purge.status()).toBe(200);
    expect(((await purge.json()) as { code: number }).code).toBe(0);
    expect(
      await prisma.aiUsageLog.count({
        where: { modelKey: MODEL_KEY, createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } },
      }),
    ).toBe(0);
    expect(
      await prisma.aiUsageLog.count({ where: { modelKey: { startsWith: "e2e-usage" } } }),
    ).toBe(4);

    // 21.4 牌价配置 UI:模型编辑弹窗回显三牌价;ASR 弹窗回显时价
    await page.goto("/admin/models/");
    await page
      .getByRole("row", { name: /e2e-用量模型/ })
      .getByRole("button", { name: "编辑" })
      .click();
    await expect(page.getByLabel("输入牌价(¥/1M tokens)")).toHaveValue("2");
    await expect(page.getByLabel("输出牌价(¥/1M tokens)")).toHaveValue("8");
    await expect(page.getByLabel("生图牌价(¥/张)")).toHaveValue("0.5");
    await page.getByRole("button", { name: "取消" }).click();
    await page.getByRole("tab", { name: "ASR 渠道" }).click();
    await page.getByRole("button", { name: "编辑配置" }).click();
    await expect(page.getByLabel("牌价(¥/小时音频)")).toHaveValue("10");
    await page.getByRole("button", { name: "取消" }).last().click();

    // 21.5 封面工作流冒烟(零 LLM/零网络):双源入口 → 本地注入 1×1 PNG 进裁剪
    // 工作台 → 四模板卡 + AI 行(无标题禁用)。模板卡在选图后才渲染(CoverDialog !source 分支)
    await page.goto("/admin/posts/new");
    await page.getByRole("button", { name: /设置封面/ }).click();
    await expect(page.getByText("本地上传(jpg / png / webp)")).toBeVisible();
    await expect(page.getByText("从媒体库选图")).toBeVisible();
    await page.setInputFiles('input[type="file"]', {
      name: "e2e-cover.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    await expect(page.getByText("裁剪模板")).toBeVisible();
    for (const label of ["微信公众号头图", "站内 / OG 卡片", "CSDN / 通用横图", "列表缩略图"]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
    await expect(page.getByText(/AI 生成封面/)).toBeVisible();
    // M31 验收反馈:弹窗内直连生图退役 → Agent 入口块(唤起编辑页侧栏 Agent,
    // 零真网口径不变,本例不点唤起)
    await expect(page.getByRole("button", { name: "唤起 Agent 生成候选" })).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.getByText("本地上传(jpg / png / webp)")).toBeHidden();
  } finally {
    await prisma.aiUsageLog.deleteMany({});
    for (let i = 0; i < externalUsage.length; i += 500) {
      await prisma.aiUsageLog.createMany({
        data: externalUsage.slice(i, i + 500).map((r) => ({ ...r, id: undefined })),
      });
    }
    await prisma.aiModel.deleteMany({ where: { modelId: MODEL_KEY } });
    if (asrBefore) {
      await prisma.asrConfig.update({
        where: { id: 1 },
        data: { pricePerHour: asrBefore.pricePerHour },
      });
    } else {
      await prisma.asrConfig.deleteMany({ where: { id: 1 } });
    }
  }
});

test("22. 编辑器右栏收起(M16:完全隐藏/localStorage 持久化/展开恢复)", async ({ page }) => {
  // 登录(同前序用例 UI 流)
  await page.goto("/admin/login");
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);

  await page.goto("/admin/posts/new");
  const collapse = page.getByLabel("收起侧栏");
  await expect(collapse).toBeVisible();
  // 右栏在:meta 面板「分类」label 可见
  const categoryLabel = page.getByLabel("分类");
  await expect(categoryLabel).toBeVisible();

  // 收起 = 右栏完全不渲染(aria-label 翻转 + 分类 label 消失)
  await collapse.click();
  const expand = page.getByLabel("展开侧栏");
  await expect(expand).toBeVisible();
  await expect(categoryLabel).toHaveCount(0);

  // 刷新后仍收起(mount 后读 localStorage ah:editor:sidebar-collapsed)
  await page.reload();
  await expect(page.getByLabel("展开侧栏")).toBeVisible();
  await expect(page.getByLabel("分类")).toHaveCount(0);

  // 展开恢复:右栏回归,后续进入默认展开(状态写回 "0")
  await page.getByLabel("展开侧栏").click();
  await expect(page.getByLabel("分类")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("收起侧栏")).toBeVisible();
  await expect(page.getByLabel("分类")).toBeVisible();
});

test("23. 一键发文补选交互(M16:md 先行/逐引用选图即时上传/多次选择累积不清空)", async ({
  page,
}) => {
  const IMG_NAME = "e2e-pick-img.png";
  const IMG_NAME2 = "e2e-pick-extra.png";
  await prisma.media.deleteMany({ where: { filename: { in: [IMG_NAME, IMG_NAME2] } } });

  // 登录(同前序用例 UI 流)
  await page.goto("/admin/login");
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);

  await page.goto("/admin/posts/");
  await page.getByRole("button", { name: "一键发文(md 导入)" }).click();
  const png = await sharp({
    create: { width: 4, height: 3, channels: 3, background: { r: 200, g: 120, b: 20 } },
  })
    .png()
    .toBuffer();
  const md = `# E2E 补选\n\n![配图](./imgs/${IMG_NAME})\n`;

  // ① md 先行、不选图:引用列出,未命中行带「选图」(本地图 0)
  await page
    .locator('input[accept=".md,.markdown"]')
    .setInputFiles([
      { name: "e2e-pick.md", mimeType: "text/markdown", buffer: Buffer.from(md, "utf8") },
    ]);
  await expect(page.getByText(/图片引用 1 处/)).toBeVisible();
  const pickBtn = page.getByRole("button", { name: "选图" });
  await expect(pickBtn).toBeVisible();

  // ② 逐引用补选(filechooser):即时上传 → 状态 ✓ + 站内路径;「选图」随之消失
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), pickBtn.click()]);
  await chooser.setFiles([{ name: IMG_NAME, mimeType: "image/png", buffer: png }]);
  await expect(page.getByText("已选图片 1 张")).toBeVisible();
  await expect(page.getByText("✓")).toBeVisible();
  await expect(page.getByText(/\/wp-content\/uploads\//).first()).toBeVisible();
  await expect(pickBtn).toHaveCount(0);

  // ③ 再经「添加图片」选一张与引用不同名图:累积不清空(已选 2 张),先前 ✓ 不丢
  const [chooser2] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "添加图片" }).click(),
  ]);
  await chooser2.setFiles([{ name: IMG_NAME2, mimeType: "image/png", buffer: png }]);
  await expect(page.getByText("已选图片 2 张")).toBeVisible();
  await expect(page.getByText("✓")).toBeVisible();

  // ④ 开始导入 → 编辑器交接,引用已替换站内路径
  await page.getByRole("button", { name: "开始导入" }).click();
  await page.waitForURL(/\/admin\/posts\/new\/\?import=1/);
  const ta = page.locator("textarea.vditor-sv");
  await expect(ta).toHaveValue(/!\[配图\]\(\/wp-content\/uploads\//);

  // 清理:媒体行 + 盘上文件族(与用例 8 同款)
  const rows = await prisma.media.findMany({ where: { filename: { in: [IMG_NAME, IMG_NAME2] } } });
  const root = path.resolve(process.cwd(), process.env.MEDIA_DIR ?? "workspace/media");
  for (const row of rows) {
    const rel = decodeURIComponent(row.path.replace("/wp-content/uploads/", ""));
    const stem = rel.replace(/\.[a-z]+$/, "");
    await Promise.all(
      [rel, `${stem}.webp`, `${stem}.thumb.webp`].map((f) =>
        rm(path.join(root, f), { force: true }),
      ),
    );
    await prisma.media.delete({ where: { id: row.id } });
  }
});

test("24. 批量 SEO 补全 400 路径(M16:多选批量条/未绑定 summarize 前置拒绝,绑定即测即复原)", async ({
  page,
}) => {
  // 记录并临时置空 summarize 绑定(造「未绑定」确定性环境;finally 原样恢复,
  // 不动开发者本地真实配置;LLM 真跑属人工验收,不在 e2e 内消费额度)
  const binding = await prisma.aiTaskBinding.findUnique({ where: { role: "summarize" } });
  try {
    await prisma.aiTaskBinding.updateMany({
      where: { role: "summarize" },
      data: { primaryId: null, backupId: null },
    });

    // 登录(同前序用例 UI 流)
    await page.goto("/admin/login");
    await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
    await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await page.waitForURL(/\/admin\/?$/);

    await page.goto("/admin/posts/");
    // 勾选首行 → 批量条浮出
    await page
      .getByLabel(/^选择 /)
      .first()
      .click();
    await expect(page.getByText(/已选/)).toBeVisible();
    const batchBtn = page.getByRole("button", { name: "批量 SEO 补全(仅补空缺)" });
    await expect(batchBtn).toBeEnabled();

    // 提交 → summarize 未绑定 400 前置拒绝,错误文案入批量条,不进入轮询忙态
    await batchBtn.click();
    await expect(
      page.getByText("未绑定或未启用「摘要(summarize)」模型:先到 AI 配置完成任务绑定"),
    ).toBeVisible();
    await expect(page.getByText("批量补全中…")).toHaveCount(0);
  } finally {
    if (binding) {
      await prisma.aiTaskBinding.update({
        where: { role: "summarize" },
        data: { primaryId: binding.primaryId, backupId: binding.backupId },
      });
    }
  }
});

test("25. 一键发文目录自动配图(M16:webkitdirectory 选文件夹/md 自动选中/图片自动并入)", async ({
  page,
}) => {
  const IMG_A = "e2e-dir-hero.png";
  const IMG_B = "e2e-dir-chart.png";
  await prisma.media.deleteMany({ where: { filename: { in: [IMG_A, IMG_B] } } });

  // webkitdirectory 的 setInputFiles 只收真实目录路径:md 在根、图片在 imgs 子目录
  // (对应用户场景:md 与图片分处不同层级目录,一次选文件夹免逐张挑图)
  const png = await sharp({
    create: { width: 4, height: 3, channels: 3, background: { r: 30, g: 160, b: 90 } },
  })
    .png()
    .toBuffer();
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-import-"));
  try {
    await mkdir(path.join(dir, "imgs"));
    await writeFile(
      path.join(dir, "e2e-dir.md"),
      Buffer.from(
        `# E2E 目录导入\n\n![主图](./imgs/${IMG_A})\n\n![图表](./imgs/${IMG_B})\n`,
        "utf8",
      ),
    );
    await writeFile(path.join(dir, "imgs", IMG_A), png);
    await writeFile(path.join(dir, "imgs", IMG_B), png);

    // 登录(同前序用例 UI 流)
    await page.goto("/admin/login");
    await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
    await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await page.waitForURL(/\/admin\/?$/);

    await page.goto("/admin/posts/");
    await page.getByRole("button", { name: "一键发文(md 导入)" }).click();

    // 选文件夹:目录内 md 自动选为文章、图片自动并入,不用逐张挑
    await page.locator("input[webkitdirectory]").setInputFiles(dir);
    await expect(page.getByText(/图片引用 2 处/)).toBeVisible();
    await expect(page.getByText("已选图片 2 张")).toBeVisible();

    // 开始导入 → 两引用都替换为站内路径(同内容 sha1 去重,复用同一媒体行)
    await page.getByRole("button", { name: "开始导入" }).click();
    await page.waitForURL(/\/admin\/posts\/new\/\?import=1/);
    const ta = page.locator("textarea.vditor-sv");
    await expect(ta).toHaveValue(/!\[主图\]\(\/wp-content\/uploads\//);
    await expect(ta).toHaveValue(/!\[图表\]\(\/wp-content\/uploads\//);

    // 清理:媒体行 + 盘上文件族(与用例 23 同款)+ 临时夹具目录
    const rows = await prisma.media.findMany({ where: { filename: { in: [IMG_A, IMG_B] } } });
    const root = path.resolve(process.cwd(), process.env.MEDIA_DIR ?? "workspace/media");
    for (const row of rows) {
      const rel = decodeURIComponent(row.path.replace("/wp-content/uploads/", ""));
      const stem = rel.replace(/\.[a-z]+$/, "");
      await Promise.all(
        [rel, `${stem}.webp`, `${stem}.thumb.webp`].map((f) =>
          rm(path.join(root, f), { force: true }),
        ),
      );
      await prisma.media.delete({ where: { id: row.id } });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("26. K1 三域统一检索:/search 分组命中/高亮/g-more/空态/noindex", async ({ request }) => {
  // MARK 词取全站唯一串(词项化后单词项,contains insensitive 命中三域各 1 行)
  const MARK = "k1srchzq";
  const POST_SLUG = "e2e-k1srchzq";
  const REPO_SLUG = "e2e-k1srchzq-repo";
  const SRC_NAME = "e2e-k1-search-source";
  // 自播种:三域各 1 行含 MARK(独立渠道采集关闭;post/repo publishedAt 回拨与
  // nextSyncAt 推远,不干扰列表页「最新」序位;重跑幂等)
  const source = await prisma.crawlSource.upsert({
    where: { name: SRC_NAME },
    update: {},
    create: {
      name: SRC_NAME,
      type: "rss",
      url: "https://e2e.invalid/rss-k1",
      enabled: false,
      remark: "e2e 专用,采集关闭",
    },
  });
  await prisma.telegram.deleteMany({ where: { sourceId: source.id } });
  await prisma.telegram.create({
    data: {
      sourceId: source.id,
      title: "k1srchzq 电报快讯",
      summary: "e2e 三域检索冒烟摘要",
      url: "https://e2e.invalid/k1/1",
      publishedAt: new Date(Date.now() - 3600_000),
      contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
      aiStatus: "done",
      aiSummary: "AI 解读:k1srchzq 相关动态一览",
      aiRanAt: new Date(Date.now() - 3500_000),
    },
  });
  const category = await prisma.category.upsert({
    where: { slug: "e2e-k1" },
    update: {},
    create: { slug: "e2e-k1", name: "e2e 检索冒烟分类" },
  });
  await prisma.post.deleteMany({ where: { slug: POST_SLUG } });
  const post = await prisma.post.create({
    data: {
      slug: POST_SLUG,
      title: "k1srchzq 实战教程",
      excerpt: "k1srchzq 从零到一",
      contentMd: "k1srchzq 正文首段。",
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(Date.now() - 7200_000),
    },
  });
  await prisma.githubRepo.deleteMany({ where: { slug: REPO_SLUG } });
  await prisma.githubRepo.create({
    data: {
      fullName: "e2e/k1srchzq-repo",
      slug: REPO_SLUG,
      description: "k1srchzq 配套示例仓库",
      stars: 66,
      forks: 3,
      language: "TypeScript",
      topics: [],
      htmlUrl: "https://github.com/e2e/k1srchzq-repo",
      defaultBranch: "main",
      readmeMd: "# k1srchzq repo\n\n示例正文。",
      nextSyncAt: new Date(Date.now() + 24 * 3600_000),
    },
  });
  // K2 答案 API 确定性:假模型(http 打不通,秒失败零真金)+ search 绑定指它;
  // 生成必断流 → unavailable(error)+ failed 台账行,缓存/配额不受污染
  const fakeModel = await prisma.aiModel.create({
    data: {
      name: "e2e-k1-answer-model",
      provider: "e2e",
      modelId: "e2e-answer-model",
      protocol: "openai",
      baseUrl: "https://e2e.invalid/v1",
      timeoutSec: 5,
      concurrency: 1,
      enabled: true,
      purposes: ["search"],
    },
  });
  const bindingBefore = await prisma.aiTaskBinding.findUniqueOrThrow({
    where: { role: "search" },
  });
  await prisma.aiTaskBinding.update({
    where: { role: "search" },
    data: { primaryId: fakeModel.id, backupId: null },
  });
  // 语义榜先决=embedding 绑定:回灌库绑有真 embedding 模型,查询向量化后语义
  // 补召混进命中数(1 → 24)且烧真金——测前摘除,finally 复原(与 search 绑定
  // 交换同纪律;语义层降级=纯词项路径,行为与单榜一致)
  const embeddingBefore = await prisma.aiTaskBinding.findUniqueOrThrow({
    where: { role: "embedding" },
  });
  await prisma.aiTaskBinding.update({
    where: { role: "embedding" },
    data: { primaryId: null, backupId: null },
  });

  try {
    // 22.1 三域分组命中页:SSR 直出真实 HTML(noindex 双保险;AI 答案卡 K2 批③
    // 挂载,此刻未挂载/e2e 无绑定两种情形下均不出「AI 回答」徽标)
    const res = await request.get(`/search/?q=${MARK}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    // noindex:metadata 走页内 robots meta(/telegram 的 X-Robots-Tag 头是 middleware
    // 双保险,search 页未入 middleware 名单,页内 meta 即契约)
    expect(html).toMatch(/name="robots" content="noindex[^"]*"/);
    // RSC 文本插值会插 <!-- --> 注释节点,文本包含断言先剥离
    const text = html.replace(/<!--[\s\S]*?-->/g, "");
    // 三组组头 + mono 计数标(库内全命中数各 1)+ result-head 合计 3
    for (const head of ["资讯", "教程", "项目"]) {
      expect(html).toContain(`aria-label="${head}"`);
    }
    expect(text).toContain("[TELEGRAMS · 1 条命中]");
    expect(text).toContain("[ARTICLES · 1 条命中]");
    expect(text).toContain("[REPOS · 1 条命中]");
    expect(text).toMatch(/检索 <b[^>]*>3<\/b> 条/);
    // mark 高亮 ≥3 处(三域标题各 ≥1)
    expect(html.match(/<mark\s/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    // g-more 三链 + 文章命中走 /post/<id>-<slug>/ 终态链接
    for (const label of ["进入电报流", "全部文章", "全部项目"]) {
      expect(text).toContain(label);
    }
    expect(html).toContain(`/post/${post.id.toString()}-${POST_SLUG}/`);
    // 答案卡区域此刻为空(e2e 无模型绑定,K2 批③ 挂载后走 unavailable 不上屏)
    expect(html).not.toContain("AI 回答");

    // 22.2 零命中空态:虚线框 + 「AI 直接作答」口径
    const empty = await request.get("/search/?q=zzk1notfoundxyz");
    expect(empty.status()).toBe(200);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain("站内没有找到相关内容");
    expect(emptyHtml).toContain("AI 直接作答");
    expect(emptyHtml).not.toContain("[TELEGRAMS");

    // 22.3 空 q:仅搜索台,无结果区
    const bare = await request.get("/search/");
    expect(bare.status()).toBe(200);
    expect(await bare.text()).not.toContain("条命中");

    // 22.4 K2 答案 API:校验缺失 → 400 包络;绑定假模型 → SSE 流式头 +
    // meta(3 命中 3 引用)后生成断流 → 单帧 unavailable(error),failed 落台账
    const noQ = await request.get("/api/search/answer/");
    expect(noQ.status()).toBe(400);
    expect(((await noQ.json()) as { code: number }).code).toBe(400);
    const sse = await request.get(`/api/search/answer/?q=${MARK}`);
    expect(sse.status()).toBe(200);
    expect(sse.headers()["content-type"]).toContain("text/event-stream");
    expect(sse.headers()["x-accel-buffering"]).toBe("no");
    expect(sse.headers()["cache-control"]).toContain("no-store");
    const sseBody = await sse.text();
    expect(sseBody).toContain("event: meta");
    expect(sseBody).toContain('"total":3');
    expect(sseBody).toContain('"noHits":false');
    expect(sseBody).toContain('"kind":"post"');
    expect(sseBody).toContain("event: unavailable");
    expect(sseBody).toContain('"reason":"error"');
    expect(
      await prisma.aiUsageLog.count({ where: { role: "search", modelKey: "e2e-answer-model" } }),
    ).toBe(1);
  } finally {
    await prisma.aiTaskBinding.update({
      where: { role: "search" },
      data: { primaryId: bindingBefore.primaryId, backupId: bindingBefore.backupId },
    });
    await prisma.aiTaskBinding.update({
      where: { role: "embedding" },
      data: { primaryId: embeddingBefore.primaryId, backupId: embeddingBefore.backupId },
    });
    await prisma.aiUsageLog.deleteMany({ where: { modelKey: "e2e-answer-model" } });
    await prisma.aiModel.deleteMany({ where: { modelId: "e2e-answer-model" } });
    await prisma.telegram.deleteMany({ where: { sourceId: source.id } });
    await prisma.crawlSource.deleteMany({ where: { name: SRC_NAME } });
    await prisma.githubRepo.deleteMany({ where: { slug: REPO_SLUG } });
    await prisma.post.deleteMany({ where: { slug: POST_SLUG } });
    await prisma.category.deleteMany({ where: { slug: "e2e-k1" } });
  }
});

/** 公众号配置单例快照/复原(27-29 共用):开发者本地可能已录真实凭证,即测即复原 */
async function snapshotWechatConfig() {
  return prisma.wechatConfig.findUnique({ where: { id: 1 } });
}
async function restoreWechatConfig(snap: Awaited<ReturnType<typeof snapshotWechatConfig>>) {
  await prisma.wechatConfig.deleteMany({ where: { id: 1 } });
  if (snap) await prisma.wechatConfig.create({ data: { ...snap } });
}

/** e2e admin 登录(27-29 各自幂等 upsert 账号后走 UI 流,同 test 4 口径) */
async function e2eAdminLogin(page: import("@playwright/test").Page): Promise<void> {
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
  await page.goto("/admin/login");
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);
}

test("27. 分发中心页(M17:配置卡渲染/记录空态/渠道未就绪入口禁用+sync 400)", async ({ page }) => {
  const snap = await snapshotWechatConfig();
  // 记录表空态隔离:回灌库带历史同步记录——快照清场,finally 原样回灌
  // (id 不复原,断言不依赖)
  const syncRecords = await prisma.publishChannel.findMany();
  await prisma.publishChannel.deleteMany();
  // M50 批B:跨载体 union 后贴图渠道行也进记录表,一并清场/回灌
  const pinChannels = await prisma.contentPinChannel.findMany();
  await prisma.contentPinChannel.deleteMany();
  try {
    // 未配置确定性环境:清单例行(页面 get-or-create 会落默认禁用行)
    await prisma.wechatConfig.deleteMany({ where: { id: 1 } });
    await e2eAdminLogin(page);

    // 27.1 配置卡(未启用态)+ 记录表空态
    // M46 批F11 卡面改版:AppID/默认主题等明细移入配置弹窗(用例 28 覆盖),
    // 卡面只留 chip + meta;此处断言未配置态卡面与空态
    await page.goto("/admin/distribute");
    await expect(page.getByRole("heading", { name: "分发中心" })).toBeVisible();
    await expect(page.getByText("未启用").first()).toBeVisible();
    await expect(page.getByText("暂无同步记录")).toBeVisible();

    // 27.2 未就绪:文章列表批量「同步公众号」禁用 + 指引 tooltip(行内同步钮同款禁用)
    await page.goto("/admin/posts/");
    await page
      .getByLabel(/^选择 /)
      .first()
      .click();
    await expect(
      page.getByTitle("先到「内容分发」完成公众号配置并启用渠道").first(),
    ).toBeDisabled();

    // 27.3 sync API 400:未就绪前置在资格检查之前(POST 直打,不入队不触网)
    const res = await page.request.post("/api/distribute/wechat/sync/", {
      headers: jsonOrigin(page),
      data: { postId: "1" },
    });
    expect(res.status()).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("公众号渠道未就绪");
  } finally {
    await prisma.publishChannel.deleteMany();
    await prisma.contentPinChannel.deleteMany();
    if (pinChannels.length > 0) {
      await prisma.contentPinChannel.createMany({
        data: pinChannels.map((r) => ({
          pinId: r.pinId,
          channel: r.channel,
          status: r.status,
          mediaId: r.mediaId,
          publishId: r.publishId,
          attempts: r.attempts,
          lastError: r.lastError,
          syncedAt: r.syncedAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      });
    }
    if (syncRecords.length > 0) {
      await prisma.publishChannel.createMany({
        // 显式列字段(批X1 起行含 data JSON 列,Json.Value 不可直入 CreateManyInput)
        data: syncRecords.map((r) => ({
          postId: r.postId,
          channel: r.channel,
          status: r.status,
          mediaId: r.mediaId,
          title: r.title,
          digest: r.digest,
          thumbPath: r.thumbPath,
          theme: r.theme,
          attempts: r.attempts,
          lastError: r.lastError,
          syncedAt: r.syncedAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      });
    }
    await restoreWechatConfig(snap);
  }
});

test("27b. 分发记录跨载体汇总(M50 批B/F:载体归因/chips 筛选/探照三态)", async ({ page }) => {
  const MARK = "e2e-m50-union";
  // 幂等:上轮失败残留先清(finally 兜底外的极端残留)
  await prisma.contentPin.deleteMany({ where: { title: { startsWith: MARK } } });
  // 种子:贴图(xhs synced + wechat failed)+ 文章渠道行 + 探照快照
  const pin = await prisma.contentPin.create({
    data: {
      title: `${MARK} 贴图`,
      content: "M50 跨载体验收",
      status: "synced",
      cropSpec: "1_1",
      channels: {
        create: [
          {
            channel: "xiaohongshu",
            status: "synced",
            publishId: "https://www.xiaohongshu.com/explore/e2e-m50",
            attempts: 1,
            syncedAt: new Date(),
          },
          { channel: "wechat", status: "failed", attempts: 2, lastError: "e2e 模拟失败" },
        ],
      },
    },
  });
  const anyPost = await prisma.post.findFirst({ select: { id: true } });
  expect(anyPost).not.toBeNull(); // dev 库空库不跑本用例(数据态耦合,见文件头注)
  const artChannel = await prisma.publishChannel.create({
    data: { postId: anyPost!.id, channel: "wechat", status: "synced", attempts: 1 },
  });
  const probeValue = JSON.stringify({
    checkedAt: new Date().toISOString(),
    loggedIn: true,
    storageReady: true,
    error: null,
  });
  await prisma.siteConfig.upsert({
    where: { key: "distribute.xhs_state" },
    update: { value: probeValue },
    create: { key: "distribute.xhs_state", value: probeValue },
  });
  try {
    await e2eAdminLogin(page);

    // 27b.1 缺省列表:双载体行并存,渠道名带载体小注;chips 含双渠道
    await page.goto("/admin/distribute");
    await expect(page.getByRole("heading", { name: "分发中心" })).toBeVisible();
    await expect(page.getByText("小红书· 贴图").first()).toBeVisible();
    await expect(page.getByText("微信公众号· 文章").first()).toBeVisible();
    // 小红书行推送结果=笔记外链;内容列链组装台
    await expect(page.getByRole("link", { name: "查看笔记 ↗" }).first()).toBeVisible();
    const studioLink = page.getByRole("link", { name: `${MARK} 贴图` }).first();
    await expect(studioLink).toHaveAttribute("href", /\/admin\/studio\/\d+/);
    // 文章行仍链文章编辑
    await expect(page.getByRole("link", { name: /\S+/ }).first()).toBeVisible();

    // 27b.2 channel=xiaohongshu 筛选:仅贴图行,公众号文章行不出现
    await page.goto("/admin/distribute?channel=xiaohongshu");
    await expect(page.getByText("小红书· 贴图").first()).toBeVisible();
    await expect(page.getByText("微信公众号· 文章")).toHaveCount(0);

    // 27b.3 探照三态:种子 loggedIn=true → 卡面「已连接」chip + 每日探测行
    await expect(page.getByText("已连接", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/每日探测:/)).toBeVisible();
    await expect(page.getByText(/每日探测:.* · 有效/)).toBeVisible();
  } finally {
    await prisma.contentPinChannel.deleteMany({ where: { pinId: pin.id } });
    await prisma.contentPin.delete({ where: { id: pin.id } });
    await prisma.publishChannel.delete({ where: { id: artChannel.id } });
    await prisma.siteConfig.deleteMany({ where: { key: "distribute.xhs_state" } });
  }
});

test("28. 同步公众号弹窗(M17 批④:就绪入口/默认预填/计数拦截/封面预览/主题预览)", async ({
  page,
}) => {
  const MARK = "e2e-wxsync";
  const category = await prisma.category.upsert({
    where: { slug: "e2e-wx" },
    update: {},
    create: { slug: "e2e-wx", name: "e2e 公众号冒烟分类" },
  });
  await prisma.post.deleteMany({ where: { slug: MARK } });
  const post = await prisma.post.create({
    data: {
      slug: MARK,
      title: `${MARK} 站内标题`,
      seoTitle: `${MARK} 推送标题`,
      excerpt: "e2e 摘要回退样本",
      contentMd: "e2e 公众号同步正文。",
      coverPath: "/uploads/e2e-wxsync-cover.webp",
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(Date.now() - 1800_000),
    },
  });
  const snap = await snapshotWechatConfig();
  try {
    await e2eAdminLogin(page);
    // 造就绪:PUT 假凭证(仅开启入口;不点「推送草稿」不触微信 API)
    const put = await page.request.put("/api/distribute/wechat-config/", {
      headers: jsonOrigin(page),
      data: {
        appid: "wx-e2e-fake",
        appSecret: "e2e-secret-fake",
        author: "e2e",
        theme: "default",
        autoSyncEnabled: false,
        enabled: true,
      },
    });
    expect(put.status()).toBe(200);

    await page.goto("/admin/posts/");
    const row = page.getByRole("row", { name: new RegExp(MARK) });
    await row.getByRole("button", { name: "同步公众号" }).click();
    await expect(page.getByRole("heading", { name: "同步到公众号草稿箱" })).toBeVisible();

    // 默认预填:标题=seoTitle、摘要=excerpt、封面缩略预览
    const titleInput = page.getByLabel(/^标题/);
    await expect(titleInput).toHaveValue(`${MARK} 推送标题`);
    await expect(page.getByLabel(/^摘要/)).toHaveValue("e2e 摘要回退样本");
    await expect(page.getByAltText("封面预览")).toBeVisible();

    // 计数拦截:空标题禁提交;65 字 → 65/64 红标 + 禁用;回合法值恢复
    const submit = page.getByRole("button", { name: "推送草稿" });
    await expect(submit).toBeEnabled();
    await titleInput.fill("");
    await expect(submit).toBeDisabled();
    await titleInput.fill("长".repeat(65));
    const counter = page.getByText("65/64", { exact: true });
    await expect(counter).toBeVisible();
    await expect(counter).toHaveClass(/text-red/);
    await expect(submit).toBeDisabled();
    await titleInput.fill("合法推送标题");
    await expect(submit).toBeEnabled();

    // 主题扩展批⑧:主题色板默认高亮 + 右栏预览(preview 路由纯渲染,不触微信 API)
    await expect(page.getByText("正文预览(公众号样式)")).toBeVisible();
    await expect(page.getByText("e2e 公众号同步正文。")).toBeVisible();
    const defChip = page.getByRole("button", { name: "默认", exact: true });
    const greenChip = page.getByRole("button", { name: "青绿", exact: true });
    await expect(defChip).toHaveClass(/border-accent/);
    await greenChip.click();
    await expect(greenChip).toHaveClass(/border-accent/);
    await expect(defChip).not.toHaveClass(/border-accent/);
    await expect(page.getByText("e2e 公众号同步正文。")).toBeVisible();

    await page.getByRole("button", { name: "关闭" }).click();
    await expect(page.getByRole("heading", { name: "同步到公众号草稿箱" })).toHaveCount(0);
  } finally {
    await restoreWechatConfig(snap);
    await prisma.post.deleteMany({ where: { id: post.id } });
    await prisma.category.deleteMany({ where: { slug: "e2e-wx" } });
  }
});

test("29. 批量同步与绑定重置(M17:空/超限 400/旧文 skipped/清 media_id 绑定)", async ({ page }) => {
  const MARK = "e2e-wxbatch";
  const LEGACY_TITLE = `${MARK} 旧文`;
  const category = await prisma.category.upsert({
    where: { slug: "e2e-wxb" },
    update: {},
    create: { slug: "e2e-wxb", name: "e2e 公众号批量分类" },
  });
  // 旧文行:HTML 正文(contentMd 空)+ 有封面 → 批量预检应 skipped(不入队不触网)
  await prisma.post.deleteMany({ where: { slug: MARK } });
  const post = await prisma.post.create({
    data: {
      slug: MARK,
      title: LEGACY_TITLE,
      contentHtml: "<p>legacy e2e</p>",
      wpPostId: 987654,
      coverPath: "/uploads/e2e-wxbatch.webp",
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(Date.now() - 3600_000),
    },
  });
  await prisma.publishChannel.deleteMany({ where: { postId: post.id } });
  const ch = await prisma.publishChannel.create({
    data: { postId: post.id, channel: "wechat", status: "failed", mediaId: "e2e-media-old" },
  });
  const snap = await snapshotWechatConfig();
  try {
    await e2eAdminLogin(page);
    const put = await page.request.put("/api/distribute/wechat-config/", {
      headers: jsonOrigin(page),
      data: {
        appid: "wx-e2e-fake",
        appSecret: "e2e-secret-fake",
        author: "e2e",
        autoSyncEnabled: false,
        enabled: true,
      },
    });
    expect(put.status()).toBe(200);

    // 29.1 空 ids → 400(zod min,先于渠道检查)
    const empty = await page.request.post("/api/distribute/wechat/batch/", {
      headers: jsonOrigin(page),
      data: { ids: [] },
    });
    expect(empty.status()).toBe(400);
    // 29.2 超 30 篇 → 400(zod max)
    const over = await page.request.post("/api/distribute/wechat/batch/", {
      headers: jsonOrigin(page),
      data: { ids: Array.from({ length: 31 }, () => "1") },
    });
    expect(over.status()).toBe(400);
    expect(((await over.json()) as { message: string }).message).toContain("30");
    // 29.3 旧文 skipped:202 携回人话,eligible 0 不入队(worker 不触微信 API)
    const batch = await page.request.post("/api/distribute/wechat/batch/", {
      headers: jsonOrigin(page),
      data: { ids: [post.id.toString()] },
    });
    expect(batch.status()).toBe(202);
    const body = (await batch.json()) as {
      data: { eligible: string[]; skipped: { id: string; reason: string }[] };
    };
    expect(body.data.eligible).toEqual([]);
    expect(body.data.skipped).toHaveLength(1);
    expect(body.data.skipped[0].reason).toContain("旧文");

    // 29.4 UI 批量:勾旧文行 → 批量条「同步公众号」→ eligible 0 错误浮出
    await page.goto("/admin/posts/");
    await page.getByLabel(`选择 ${LEGACY_TITLE}`).click();
    await page.getByTitle(/^推送选中文章到公众号草稿箱/).click();
    await expect(page.getByText(/没有可同步的文章/)).toBeVisible();

    // 29.5 reset 路由:有绑定 → 清空 200(落库 mediaId=null);无绑定再清 → 400
    const reset1 = await page.request.post(`/api/distribute/records/${ch.id}/reset/`, {
      headers: jsonOrigin(page),
    });
    expect(reset1.status()).toBe(200);
    const reset2 = await page.request.post(`/api/distribute/records/${ch.id}/reset/`, {
      headers: jsonOrigin(page),
    });
    expect(reset2.status()).toBe(400);
    expect(((await reset2.json()) as { message: string }).message).toContain("没有 media_id 绑定");
  } finally {
    await restoreWechatConfig(snap);
    await prisma.publishChannel.deleteMany({ where: { postId: post.id } });
    await prisma.post.deleteMany({ where: { id: post.id } });
    await prisma.category.deleteMany({ where: { slug: "e2e-wxb" } });
  }
});

test("30. K2.5/K2.6 Drawer 深挖会话:游客线程面(g_ 前缀/不落行/归属删除)/Drawer 唤起预填/无侧栏直发降级", async ({
  page,
  request,
  playwright,
}) => {
  // 30.1 线程 API 面(APIRequestContext 独立 cookie jar:首访下发 ah_av;K2.6 起一律游客)
  const E2E_ORIGIN = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;
  const first = await request.get("/api/search/agent/threads");
  expect(first.status()).toBe(200);
  expect(first.headers()["set-cookie"] ?? "").toContain("ah_av=");
  expect(((await first.json()) as { data: unknown[] }).data).toEqual([]);

  // 新建(同源校验:无 Origin → 403;带 Origin → g_ 前缀线程,不落会话行)
  const noOrigin = await request.post("/api/search/agent/threads", { data: {} });
  expect(noOrigin.status()).toBe(403);
  const created = await request.post("/api/search/agent/threads", {
    headers: { origin: E2E_ORIGIN },
    data: {},
  });
  expect(created.status()).toBe(200);
  const threadId = ((await created.json()) as { data: { threadId: string } }).data.threadId;
  expect(threadId).toMatch(/^g_[0-9a-f-]{36}$/);
  expect(await prisma.searchAgentSession.findUnique({ where: { id: threadId } })).toBeNull();
  expect(
    ((await (await request.get("/api/search/agent/threads")).json()) as { data: unknown[] }).data,
  ).toEqual([]);
  // state 空轨迹(Redis 归属本主;values.messages 扁平序列化契约)
  const state = await request.get(`/api/search/agent/threads/${threadId}/state`);
  expect(state.status()).toBe(200);
  expect(
    ((await state.json()) as { data: { values: { messages: unknown[] } } }).data.values.messages,
  ).toEqual([]);

  // 越权:另一访客(API jar 隔离)对他人的线程删/state → 一律 404(不泄露存在性;
  // 带 Origin 过同源关,断言落到归属校验层)
  const outsider = await playwright.request.newContext();
  expect(
    (
      await outsider.delete(`/api/search/agent/threads/${threadId}`, {
        headers: { origin: E2E_ORIGIN },
      })
    ).status(),
  ).toBe(404);
  expect((await outsider.get(`/api/search/agent/threads/${threadId}/state`)).status()).toBe(404);
  await outsider.dispose();

  // 本主删除 → 200;再 state 404(归属键已解绑)
  expect(
    (
      await request.delete(`/api/search/agent/threads/${threadId}`, {
        headers: { origin: E2E_ORIGIN },
      })
    ).status(),
  ).toBe(200);
  expect((await request.get(`/api/search/agent/threads/${threadId}/state`)).status()).toBe(404);

  // 30.2 Drawer UI(浏览器上下文独立访客):唤起事件 → 游客模式无侧栏/
  // 无新建入口 + 限额口径 hint + ah_av cookie 下发 + 预填不直发
  // (dispatch 带 toPass 重试:hydration 完成前监听器未挂,事件会丢)
  await page.goto("/search/");
  await expect(async () => {
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("search:agent-ask", {
          detail: { question: "k25agent 深挖预填问题", send: false },
        }),
      ),
    );
    await expect(page.getByRole("dialog", { name: "问助手" })).toBeVisible();
  }).toPass({ timeout: 15_000 });
  const drawer = page.getByRole("dialog", { name: "问助手" });
  await expect(drawer).toBeVisible();
  await expect(page.getByPlaceholder(/继续深挖/)).toHaveValue("k25agent 深挖预填问题");
  await expect(drawer.getByRole("button", { name: "新会话" })).toHaveCount(0);
  await expect(drawer.getByText(/游客模式 · 每日 3 问 · 会话 2 小时未活动自动清退/)).toBeVisible();

  // 直发无绑定模型:run 秒败收束(错误帧)——用户气泡落屏、发送钮回位、无 AI 回复;
  // 建线程调用回包下发 ah_av cookie(游客身份锚)
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("search:agent-ask", {
        detail: { question: "k25agent 无绑定直发问题", send: true },
      }),
    ),
  );
  await expect(drawer.getByText("k25agent 无绑定直发问题")).toBeVisible();
  // exact:错误横幅按钮「…就无法直接发送消息」以「发送」结尾,无 exact 会 strict 相撞
  await expect(drawer.getByRole("button", { name: "发送", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === "ah_av")).toBe(true);

  // 30.3 清场:游客无会话行;清游客 Redis 归属键与失败 run 残留的 checkpoint
  const gkeys = await e2eRedis.keys("search:agent:gthread:*");
  if (gkeys.length > 0) await e2eRedis.del(...gkeys);
  await prisma.$executeRawUnsafe(
    `DELETE FROM checkpoints WHERE thread_id LIKE 'g\\_%' AND checkpoint_ns = ''`,
  );
});

test("31. K2.6 游客模式:归属隔离/3 问日限 429/后台会话管理(列表 API+页面+侧栏激活)", async ({
  page,
  request,
}) => {
  const E2E_ORIGIN = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;
  const GUEST_A = "e2e5a7e0-1111-4111-8111-00000000a031";
  const GUEST_B = "e2e5b7e0-2222-4222-8222-00000000b032";
  // lazyConnect:命令级自连(30 号段可能已建连,显式 connect 会重复报错)

  // 31.1 游客 A 建线程(固定 ah_av 身份)→ g_ 前缀 + 不落会话行
  await page.context().addCookies([{ name: "ah_av", value: GUEST_A, url: E2E_ORIGIN }]);
  await page.goto("/search/");
  const guestThreadId = await page.evaluate(async () => {
    const res = await fetch("/api/search/agent/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return ((await res.json()) as { data: { threadId: string } }).data.threadId;
  });
  expect(guestThreadId).toMatch(/^g_[0-9a-f-]{36}$/);
  expect(await prisma.searchAgentSession.findUnique({ where: { id: guestThreadId } })).toBeNull();
  expect(await e2eRedis.get(`search:agent:gthread:${guestThreadId}`)).toBe(GUEST_A);

  // 游客 B 对 A 的线程 state → 404(信息隔离,上下文互不影响)
  await page.context().addCookies([{ name: "ah_av", value: GUEST_B, url: E2E_ORIGIN }]);
  const bState = await page.evaluate(async (id) => {
    const res = await fetch(`/api/search/agent/threads/${id}/state`);
    return res.status;
  }, guestThreadId);
  expect(bState).toBe(404);

  // 回身份 A:种子游客日限 3 → 第 4 问 runs/stream 429(配额在模型调用前,终败也计数口径)
  await page.context().addCookies([{ name: "ah_av", value: GUEST_A, url: E2E_ORIGIN }]);
  await e2eRedis.set(guestAskKey(GUEST_A), "3");
  const quotaRes = await page.evaluate(async (id) => {
    const res = await fetch(`/api/search/agent/threads/${id}/runs/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { messages: [{ type: "human", content: "k26 配额验证" }] } }),
    });
    return { status: res.status, body: (await res.json()) as { code: number; message: string } };
  }, guestThreadId);
  expect(quotaRes.status).toBe(429);
  expect(quotaRes.body.message).toContain("今日游客提问次数已用完");

  // 31.2 后台会话管理:无会话 401;admin 登录后列表契约 + 页面/侧栏激活
  const anon = await request.get("/api/agent-sessions");
  expect(anon.status()).toBe(401);

  await page.goto("/admin/login");
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);

  // 侧栏「AI 用量」在(会话已并入其「会话」页签,侧栏精简批②)
  await expect(page.getByRole("link", { name: "AI 用量" })).toBeVisible();
  await page.goto("/admin/usage/sessions/");
  await expect(page.getByRole("heading", { name: "会话管理" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^全部 \d+$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^成员会话 \d+$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^游客会话 \d+$/ })).toBeVisible();

  // 列表 API 契约(code 0,items+counts);detail 对无台账无归属键的线程 404
  const list = await page.evaluate(async () => {
    const res = await fetch("/api/agent-sessions?page=1&kind=all");
    return (await res.json()) as {
      code: number;
      data?: { items: unknown[]; counts: { all: number; member: number; guest: number } };
    };
  });
  expect(list.code).toBe(0);
  expect(Array.isArray(list.data?.items)).toBe(true);
  expect(list.data?.counts).toHaveProperty("guest");

  // 31.3 清场:种子键 + 游客归属键 + 残留 checkpoint
  // (e2eRedis 是全文件共享夹具,禁在本用例 quit——曾致 37 的 finally 撞
  // "Connection is closed";生命周期统一由 afterAll disconnect 收口)
  await e2eRedis.del(guestAskKey(GUEST_A), `search:agent:gthread:${guestThreadId}`);
  await prisma.$executeRawUnsafe(
    `DELETE FROM checkpoints WHERE thread_id LIKE 'g\\_%' AND checkpoint_ns = ''`,
  );
});

test("32. 文章评论与点赞(M23 批②:评论区渲染/两级楼层/游客点赞去重回退/未登录引导)", async ({
  page,
  request,
}) => {
  const TITLE = "E2E 冒烟 M23 评论点赞";
  const SLUG = "e2e-m23-post";
  const CAT_SLUG = "e2e-m23-cat";
  // 自播种:独立已发布文 + 根评论/楼中楼/隐藏根(重跑幂等)
  await prisma.post.deleteMany({ where: { OR: [{ title: TITLE }, { slug: SLUG }] } });
  const category = await prisma.category.upsert({
    where: { slug: CAT_SLUG },
    update: {},
    create: { slug: CAT_SLUG, name: "e2e-M23" },
  });
  const post = await prisma.post.create({
    data: {
      slug: SLUG,
      title: TITLE,
      contentMd: "M23 评论区冒烟正文。",
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(),
    },
  });
  const root = await prisma.postComment.create({
    data: {
      postId: post.id,
      authorName: "e2e旧站友",
      content: "e2e 根评论甲",
      status: "visible",
      parentId: null,
      wpCommentId: BigInt(900001),
    },
  });
  await prisma.postComment.create({
    data: {
      postId: post.id,
      authorName: "e2e站长",
      content: "e2e 楼中楼乙",
      status: "visible",
      parentId: root.id,
    },
  });
  await prisma.postComment.create({
    data: {
      postId: post.id,
      authorName: "e2e隐藏者",
      content: "e2e 隐藏根丙",
      status: "hidden",
      parentId: null,
    },
  });

  try {
    // API 契约:total 只数根;BigInt 已字符串化;hidden 不出境
    const api = await request.get(`/api/post-comments?postId=${post.id}`);
    expect(api.status()).toBe(200);
    const body = (await api.json()) as {
      code: number;
      data: { total: number; items: Array<{ id: string; replies: Array<{ content: string }> }> };
    };
    expect(body.code).toBe(0);
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]!.id).toBe(root.id.toString());
    expect(body.data.items[0]!.replies.map((r) => r.content)).toEqual(["e2e 楼中楼乙"]);

    // 详情页:评论区壳 + 种子评论(含「旧站」迁移徽标)+ 隐藏根不上屏 + 未登录引导
    await page.goto(`/post/${post.id}-${SLUG}/`);
    await expect(page.getByRole("heading", { name: /评论 \d+/ })).toBeVisible();
    await expect(page.getByText("e2e 根评论甲")).toBeVisible();
    await expect(page.getByText("e2e 楼中楼乙")).toBeVisible();
    await expect(page.getByText("旧站", { exact: true })).toBeVisible();
    await expect(page.getByText("e2e 隐藏根丙")).toHaveCount(0);
    await expect(page.getByText("登录后即可评论")).toBeVisible();

    // 未登录 POST 评论 401(写侧门)
    const anonPost = await page.evaluate(async (pid) => {
      const res = await fetch("/api/post-comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId: pid, content: "游客不许" }),
      });
      return res.status;
    }, post.id.toString());
    expect(anonPost).toBe(401);

    // 游客点赞:点击 → 已赞+1;刷新(cookie 身份持久)仍赞;再点 → 取消回退。
    // 注意:点赞后按钮文案翻转为「已赞 N」,原「点赞」定位符随之失配——
    // 用 /已赞/ 正则取翻转后的按钮(计数并入可访问名,不能 exact)
    const likeBtn = page.getByRole("button", { name: "点赞", exact: true });
    await expect(likeBtn).toBeVisible();
    await likeBtn.click();
    const likedBtn = page.getByRole("button", { name: /已赞/ });
    await expect(likedBtn).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
    await expect(likedBtn).toContainText("1");
    await page.reload();
    const likedBtn2 = page.getByRole("button", { name: /已赞/ });
    await expect(likedBtn2).toBeVisible({ timeout: 10_000 });
    await likedBtn2.click();
    await expect(page.getByRole("button", { name: "点赞", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    expect(await prisma.postLike.count({ where: { postId: post.id } })).toBe(0); // toggle 语义:取消即删行,同游客同文仅一行
  } finally {
    await prisma.postComment.deleteMany({ where: { postId: post.id } });
    await prisma.postLike.deleteMany({ where: { postId: post.id } });
    await prisma.post.deleteMany({ where: { id: post.id } });
    await prisma.category.deleteMany({ where: { slug: CAT_SLUG } });
  }
});

test("33. 数据中心·挖掘与词库(M25 候选终审+批准自动登记博主;2026-10-18 数据壳重组后挖掘页 /admin/data/mine、词库 /admin/data/sources;加词与状态流转/触发校验,零真网)", async ({
  page,
  request,
}) => {
  const KW_NEW = "e2e-kw-alpha"; // UI 新增词
  const KW_SEED = "e2e-kw-beta"; // 预置联想词(origin=hotword pending)
  const BLOGGER_MID = "e2e-mid-99001";
  const VIDEO_BVID = "BVe2e000033";
  // 自播种:一条联想 pending 词 + 博主/视频候选各一(身份含 e2e 段,不撞真数据;重跑幂等)
  await prisma.discoveryKeyword.deleteMany({ where: { word: { in: [KW_NEW, KW_SEED] } } });
  await prisma.discoveryKeyword.create({
    data: { word: KW_SEED, origin: "hotword", status: "pending", source: "bili-suggest" },
  });
  await prisma.discoveryCandidate.deleteMany({
    where: { OR: [{ externalId: BLOGGER_MID }, { externalId: VIDEO_BVID }] },
  });
  await prisma.discoveryCandidate.create({
    data: {
      type: "blogger",
      platform: "bilibili",
      externalId: BLOGGER_MID,
      round: "20261012",
      author: "e2e-发现博主",
      homepageUrl: `https://space.bilibili.com/${BLOGGER_MID}`,
      hitKeywords: [KW_SEED],
      hitCount: 3,
      maxPlay: 120000,
      fans: 45000,
      archives: 210,
      sampleTitles: ["e2e 样本标题一", "e2e 样本标题二"],
      l0Verdict: "pass",
      l0Reason: "无负面信号",
    },
  });
  await prisma.discoveryCandidate.create({
    data: {
      type: "video",
      platform: "bilibili",
      externalId: VIDEO_BVID,
      round: "20261012",
      title: "e2e 发现热点视频",
      author: "e2e-发现UP主",
      homepageUrl: `https://www.bilibili.com/video/${VIDEO_BVID}`,
      hitKeywords: [KW_SEED],
      hitCount: 2,
      maxPlay: 88000,
      totalPlay: 88000,
      l0Verdict: "reject",
      l0Reason: "标题命中营销特征词:资源",
    },
  });

  try {
    // 登录(同前序用例 UI 流)
    await page.goto("/admin/login");
    await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
    await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await page.waitForURL(/\/admin\/?$/);
    const origin = jsonOrigin(page);
    const serverOrigin = originOf(page);

    // 候选 tab(默认):播种两行在,L0 徽标/信号列/拒绝理由如实呈现
    await page.goto("/admin/data/mine/");
    await expect(page.getByRole("link", { name: "数据中心" })).toBeVisible(); // 侧栏入口(数据壳重组起项名)
    await expect(page.getByRole("heading", { name: "挖掘", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "候选治理" })).toBeVisible();
    const bloggerRow = page.getByRole("row", { name: /e2e-发现博主/ });
    await expect(bloggerRow).toBeVisible();
    await expect(bloggerRow.getByText(`mid ${BLOGGER_MID}`)).toBeVisible();
    await expect(bloggerRow.getByText("样本×2")).toBeVisible();
    await expect(bloggerRow.getByText("pass", { exact: true })).toBeVisible();
    const videoRow = page.getByRole("row", { name: /e2e 发现热点视频/ });
    await expect(videoRow).toBeVisible();
    await expect(videoRow.getByText("reject", { exact: true })).toBeVisible();
    await expect(videoRow.getByText("标题命中营销特征词:资源")).toBeVisible();

    // 列表 API(会话 GET):出参 BigInt 已字符串化,候选带样本投影
    const api = await page.request.get("/api/discovery/candidates/");
    expect(api.status()).toBe(200);
    const apiBody = (await api.json()) as {
      code: number;
      data: {
        items: Array<{
          id: string;
          type: string;
          status: string;
          externalId: string;
          sampleTitles: string[];
        }>;
        counts: Record<string, number>;
      };
    };
    expect(apiBody.code).toBe(0);
    const videoHit = apiBody.data.items.find((i) => i.externalId === VIDEO_BVID);
    expect(videoHit?.type).toBe("video");
    expect(videoHit?.sampleTitles).toEqual([]);
    const bloggerId = apiBody.data.items.find((i) => i.externalId === BLOGGER_MID)!.id;

    // 终审(同源 PUT):批准博主候选 → 行内徽标翻「已批准」;批准即自动登记
    // 进发现中心「博主」页签台账(M26 批③追加):social_account 落库 enabled=true,出参附 id
    const put = await page.request.put(`/api/discovery/candidates/${bloggerId}/`, {
      headers: origin,
      data: { status: "approved" },
    });
    expect(put.status()).toBe(200);
    const putBody = (await put.json()) as {
      code: number;
      message: string;
      data: { socialAccountId: string | null };
    };
    expect(putBody.data.socialAccountId).toBeTruthy();
    expect(putBody.message).toContain("已自动登记");
    const registered = await prisma.socialAccount.findFirst({
      where: { platform: "bilibili", secUid: BLOGGER_MID },
    });
    expect(registered?.enabled).toBe(true);
    expect(registered?.nickname).toBe("e2e-发现博主");
    // 重复批准幂等:跳过登记,不产生第二行
    const putAgain = await page.request.put(`/api/discovery/candidates/${bloggerId}/`, {
      headers: origin,
      data: { status: "approved" },
    });
    expect(putAgain.status()).toBe(200);
    const putAgainBody = (await putAgain.json()) as { message: string };
    expect(putAgainBody.message).toContain("跳过重复登记");
    expect(
      await prisma.socialAccount.count({ where: { platform: "bilibili", secUid: BLOGGER_MID } }),
    ).toBe(1);
    // 视频候选批准不触发登记(message 保持 "ok",无 social_account 行)
    const videoApiId = apiBody.data.items.find((i) => i.externalId === VIDEO_BVID)!.id;
    const putVideo = await page.request.put(`/api/discovery/candidates/${videoApiId}/`, {
      headers: origin,
      data: { status: "approved" },
    });
    expect(putVideo.status()).toBe(200);
    const putVideoBody = (await putVideo.json()) as {
      message: string;
      data: { socialAccountId: string | null };
    };
    expect(putVideoBody.message).toBe("ok");
    expect(putVideoBody.data.socialAccountId).toBeNull();
    expect(
      await prisma.socialAccount.count({ where: { platform: "bilibili", secUid: VIDEO_BVID } }),
    ).toBe(0);
    // 视频候选回退待定(三态可逆),恢复末段「已批准分段不含 pending」断言前提
    await page.request.put(`/api/discovery/candidates/${videoApiId}/`, {
      headers: origin,
      data: { status: "pending" },
    });
    await page.reload();
    // 行内两处「已批准」(状态徽标 + 流转钮组当前态),任一在即终审生效
    await expect(
      page
        .getByRole("row", { name: /e2e-发现博主/ })
        .getByText("已批准")
        .first(),
    ).toBeVisible();

    // 参数防线:非法 status 400 / 非法 id 400 / 未知 id 404 / 无会话 401
    const badStatus = await page.request.put(`/api/discovery/candidates/${bloggerId}/`, {
      headers: origin,
      data: { status: "junk" },
    });
    expect(badStatus.status()).toBe(400);
    const badId = await page.request.put("/api/discovery/candidates/nope/", {
      headers: origin,
      data: { status: "approved" },
    });
    expect(badId.status()).toBe(400);
    const missing = await page.request.put("/api/discovery/candidates/999999999/", {
      headers: origin,
      data: { status: "approved" },
    });
    expect(missing.status()).toBe(404);
    const anonCtx = await page.context().browser()!.newContext();
    const anon = await anonCtx.request.put(`/api/discovery/candidates/${bloggerId}/`, {
      headers: { origin: serverOrigin },
      data: { status: "approved" },
    });
    expect(anon.status()).toBe(401);
    await anonCtx.close();

    // 触发 API:非法 job 400;PAT 到场 403(发现面仅会话通道)。真触发不入
    // e2e——worker 在场即会真出网,留待批④真机验收
    const badJob = await page.request.post("/api/discovery/trigger/", {
      headers: origin,
      data: { job: "douyin" },
    });
    expect(badJob.status()).toBe(400);
    const patTrigger = await request.post("/api/discovery/trigger/", {
      headers: { authorization: "Bearer e2e-not-a-token", origin: serverOrigin },
      data: { job: "bili" },
    });
    expect(patTrigger.status()).toBe(403);

    // 词库视图(源管理页,数据壳重组后独立路由):预置联想词在(来源与待定态);
    // UI 加词 → origin=manual 直接生效
    await page.goto("/admin/data/sources/?t=words");
    const seedRow = page.getByRole("row", { name: new RegExp(KW_SEED) });
    await expect(seedRow).toBeVisible();
    await expect(seedRow.getByText("联想 · bili-suggest")).toBeVisible();
    // 行内两处「待定」(状态徽标 + 流转钮组当前态),任一在即
    await expect(seedRow.getByText("待定").first()).toBeVisible();

    const input = page.getByPlaceholder(/人工添加热词/);
    await input.fill(KW_NEW);
    await page.getByRole("button", { name: "添加", exact: true }).click();
    const newRow = page.getByRole("row", { name: new RegExp(KW_NEW) });
    await expect(newRow).toBeVisible({ timeout: 10_000 });
    await expect(newRow.getByText("生效").first()).toBeVisible();
    await expect(newRow.getByText("人工", { exact: true })).toBeVisible();

    // 词库 API(active 分段):新词在
    const kwApi = await page.request.get("/api/discovery/keywords/?status=active");
    expect(kwApi.status()).toBe(200);
    const kwBody = (await kwApi.json()) as {
      code: number;
      data: { items: Array<{ word: string; status: string }>; counts: Record<string, number> };
    };
    expect(kwBody.code).toBe(0);
    expect(kwBody.data.items.some((i) => i.word === KW_NEW)).toBe(true);

    // 重复加词 → 409 行内提示(带当前状态,不算故障)
    await input.fill(KW_NEW);
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await expect(page.getByText(/关键词已存在/)).toBeVisible();

    // 词状态流转(UI 直点,可逆):生效 → 已弃用
    await newRow.getByRole("button", { name: "已弃用" }).click();
    await expect(newRow.getByText("已弃用").first()).toBeVisible({ timeout: 10_000 });

    // 候选分段筛选:已批准段只含终审行,pending 视频不在(词库视图在源管理页,
    // 无挖掘 SubTabs 回链,goto 直返挖掘页)
    await page.goto("/admin/data/mine/");
    await page.getByRole("link", { name: /^已批准/ }).click();
    await page.waitForURL(/status=approved/);
    await expect(page.getByRole("row", { name: /e2e-发现博主/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /e2e 发现热点视频/ })).toHaveCount(0);
  } finally {
    // 自动登记的博主行一并清(平台行 social:bilibili 为共享单例,不删)
    await prisma.socialAccount.deleteMany({
      where: { platform: "bilibili", secUid: { in: [BLOGGER_MID, VIDEO_BVID] } },
    });
    await prisma.discoveryKeyword.deleteMany({ where: { word: { in: [KW_NEW, KW_SEED] } } });
    await prisma.discoveryCandidate.deleteMany({
      where: { OR: [{ externalId: BLOGGER_MID }, { externalId: VIDEO_BVID }] },
    });
  }
});

test("34. 创作中心(M42 由专题治理台重构:新建/添加仅已解读/批注/人工状态流转/产出动作防线/权限防线,零真网)", async ({
  page,
  request,
}) => {
  const TOPIC_TITLE = "e2e 专题-端侧AI落地";
  const PIN_TITLE = "e2e 创作产出贴图";
  const TG_DONE = "e2e 专题素材视频·已解读";
  const TG_PENDING = "e2e 专题素材视频·未解读";
  const NOTE = "e2e 批注:合成时突出端侧推理成本曲线";
  // 自播种:独立渠道 + 已解读/未解读视频各一(身份含 e2e 段不撞真数据;重跑幂等)
  const source = await prisma.crawlSource.upsert({
    where: { name: "e2e-topics-source" },
    update: {},
    create: {
      name: "e2e-topics-source",
      type: "rss",
      url: "https://e2e.invalid/rss-topics",
      enabled: false,
      remark: "e2e 专用,采集关闭",
    },
  });
  await prisma.telegram.deleteMany({
    where: { sourceId: source.id, title: { in: [TG_DONE, TG_PENDING] } },
  });
  const tgDone = await prisma.telegram.create({
    data: {
      sourceId: source.id,
      title: TG_DONE,
      summary: "e2e 专题冒烟摘要",
      url: "https://e2e.invalid/video/34",
      publishedAt: new Date(),
      contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
      mediaType: "video",
      videoPlatform: "bilibili",
      videoBlogger: "e2e-专题UP主",
      aiStatus: "done",
      aiSummary: "e2e 短结论:端侧模型落地在成本曲线上过了拐点",
      aiNote: "## 背景与问题\n端侧部署的算力/成本权衡,e2e 笔记正文段。",
      aiRanAt: new Date(),
    },
  });
  const tgPending = await prisma.telegram.create({
    data: {
      sourceId: source.id,
      title: TG_PENDING,
      summary: "e2e 专题冒烟摘要(解读在队列)",
      url: "https://e2e.invalid/video/35",
      publishedAt: new Date(),
      contentHash: createHash("sha1").update(randomBytes(16)).digest("hex"),
      mediaType: "video",
      videoPlatform: "bilibili",
      videoBlogger: "e2e-专题UP主",
      aiStatus: "pending",
    },
  });
  await prisma.topic.deleteMany({ where: { title: TOPIC_TITLE } });

  try {
    // 登录(同前序用例 UI 流)
    await page.goto("/admin/login");
    await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
    await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await page.waitForURL(/\/admin\/?$/);
    const origin = jsonOrigin(page);
    const serverOrigin = originOf(page);

    // 旧路径承接(M42):专题管理 → 创作中心 308,老书签不断
    await page.goto("/admin/topics");
    await expect(page).toHaveURL(/\/admin\/studio\/?$/);

    // 列表页:侧栏入口/标题分段签;UI 新建创作 → 直跳详情
    await page.goto("/admin/studio/");
    await expect(page.getByRole("link", { name: "创作中心" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "创作中心" })).toBeVisible();
    await page.getByRole("button", { name: "新建创作" }).click();
    await page.getByPlaceholder("创作标题(必填,≤200 字符)…").fill(TOPIC_TITLE);
    await page.getByPlaceholder(/写作要求\(可选/).fill("e2e 定位:面向开发者的端侧落地盘点");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await page.waitForURL(/\/admin\/studio\/\d+\/?$/); // trailingSlash 归一后带尾斜杠
    const topicId = new URL(page.url()).pathname.split("/").filter(Boolean).pop()!;

    // 详情:概览区(标题/收集中态);人工钮组只有「标记为已发布」(§10-7 无 drafted)
    await expect(page.getByLabel("创作标题")).toHaveValue(TOPIC_TITLE);
    await expect(page.getByText(/^素材收集中:/)).toBeVisible();
    await expect(page.getByRole("button", { name: "标记为已发布" })).toBeVisible();
    await expect(page.getByRole("button", { name: "退回收集素材" })).toHaveCount(0);
    await expect(page.getByText("还没有素材")).toBeVisible();

    // 写作要求配置区(§13.8 交互重设计):四维构建器在位;新建时自填定位 →
    // 自由文本无损落「补充要求」独立块;点选项不弹确认不销毁内容,切选项后
    // 补充要求原样保留,保存 toast 回显
    await expect(page.getByText("口吻语感", { exact: true })).toBeVisible();
    await expect(page.getByLabel("补充要求", { exact: true })).toHaveValue(/端侧落地盘点/);
    await page.getByRole("button", { name: "专业编辑" }).click();
    await expect(page.getByLabel("补充要求", { exact: true })).toHaveValue(/端侧落地盘点/);
    await page.getByRole("button", { name: "保存写作要求" }).click();
    await expect(page.getByText("写作要求已保存,生成初稿时生效")).toBeVisible({ timeout: 10_000 });

    // 双配置独立列(M42;v2 工作台:舞台页签「贴图」联动右侧配置栏)改张数保存
    // → 刷新仍在;切回「长文」长文配置不被派生污染
    await page.getByRole("button", { name: /^贴图/ }).click();
    await page.getByLabel("张数").fill("8");
    await page.getByRole("button", { name: "保存贴图配置" }).click();
    await expect(page.getByText("贴图配置已保存,生成贴图时生效")).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await page.getByRole("button", { name: /^贴图/ }).click();
    await expect(page.getByLabel("张数")).toHaveValue("8");
    await page.getByRole("button", { name: /^长文/ }).click();
    await expect(page.getByLabel("补充要求", { exact: true })).toHaveValue(/端侧落地盘点/);

    // 从库添加素材(v2 弹层):已解读视频在列,未解读不上榜;添加 → 行翻「已添加」
    await page.getByRole("button", { name: "添加素材" }).click();
    const candRow = page.getByRole("row", { name: new RegExp(TG_DONE) });
    await expect(candRow).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(TG_PENDING) })).toHaveCount(0);
    await candRow.getByRole("button", { name: "添加", exact: true }).click();
    await expect(candRow.getByText("已添加")).toBeVisible({ timeout: 10_000 });
    // 素材卡在左栏刷新出现(弹层之下),断言后关弹层再做批注等栏内操作
    const materialCard = page.getByText("短结论:e2e 短结论:端侧模型落地在成本曲线上过了拐点");
    await expect(materialCard).toBeVisible();
    await expect(page.getByText(/解读笔记\(\d+ 字\)/)).toBeVisible();
    await page.getByRole("button", { name: "关闭" }).click();

    // 重挂与未解读防线(会话同源 POST):唯一键冲突 409;未解读 409(invalid_material)
    const realDup = await page.request.post(`/api/topics/${topicId}/items/`, {
      headers: origin,
      data: { itemType: "telegram", itemId: tgDone.id.toString() },
    });
    expect(realDup.status()).toBe(409);
    const notDone = await page.request.post(`/api/topics/${topicId}/items/`, {
      headers: origin,
      data: { itemType: "telegram", itemId: tgPending.id.toString() },
    });
    expect(notDone.status()).toBe(409);

    // 详情 API:挂载行在,出参 BigInt 已字符串化
    const detail = await page.request.get(`/api/topics/${topicId}/`);
    expect(detail.status()).toBe(200);
    const detailBody = (await detail.json()) as {
      code: number;
      data: { items: Array<{ id: string; note: string | null }> };
    };
    expect(detailBody.code).toBe(0);
    expect(detailBody.data.items).toHaveLength(1);

    // 批注:UI 内联编辑 → 保存后按钮翻「改批注」;API 出参带批注
    await page.getByRole("button", { name: "加批注" }).click();
    await page.getByPlaceholder(/批注\(给生成初稿的定向提示/).fill(NOTE);
    await page.getByRole("button", { name: "保存批注" }).click();
    await expect(page.getByRole("button", { name: "改批注" })).toBeVisible({ timeout: 10_000 });
    const withNote = await page.request.get(`/api/topics/${topicId}/`);
    const withNoteBody = (await withNote.json()) as typeof detailBody;
    expect(withNoteBody.data.items[0]!.note).toBe(NOTE);

    // 人工状态流转全链(UI 直点):收集素材中→已发布→撤回发布→退回收集素材
    await page.getByRole("button", { name: "标记为已发布" }).click();
    await expect(page.getByText(/^已发布:/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "撤回发布" })).toBeVisible();
    // 防线:published→collecting 逆跳 409
    const badBack = await page.request.patch(`/api/topics/${topicId}/`, {
      headers: origin,
      data: { status: "collecting" },
    });
    expect(badBack.status()).toBe(409);
    page.once("dialog", (d) => d.accept()); // 撤回发布带后果确认
    await page.getByRole("button", { name: "撤回发布" }).click();
    await expect(page.getByText(/^已出稿:/)).toBeVisible({ timeout: 10_000 });
    page.once("dialog", (d) => d.accept()); // 退回收集素材带后果确认
    await page.getByRole("button", { name: "退回收集素材" }).click();
    await expect(page.getByText(/^素材收集中:/)).toBeVisible({ timeout: 10_000 });
    // §10-7 边界:UI 不出 collecting→drafted 钮(上方 toHaveCount(0) 已验);
    // API 层按设计不收紧(运营纪律,repo 层流转矩阵放行)→ 200 落 drafted
    const composePath = await page.request.patch(`/api/topics/${topicId}/`, {
      headers: origin,
      data: { status: "drafted" },
    });
    expect(composePath.status()).toBe(200);
    const draftedBody = (await composePath.json()) as { data: { status: string } };
    expect(draftedBody.data.status).toBe("drafted");

    // 参数与权限防线:非法 id 400 / 未知 id 404 / 匿名 401 / PAT 403
    const badId = await page.request.patch("/api/topics/nope/", {
      headers: origin,
      data: { status: "published" },
    });
    expect(badId.status()).toBe(400);
    const missing = await page.request.get("/api/topics/999999999/");
    expect(missing.status()).toBe(404);
    const anonCtx = await page.context().browser()!.newContext();
    const anon = await anonCtx.request.post("/api/topics/", {
      headers: { origin: serverOrigin },
      data: { title: "e2e 匿名专题" },
    });
    expect(anon.status()).toBe(401);
    await anonCtx.close();
    const pat = await request.post("/api/topics/", {
      headers: { authorization: "Bearer e2e-not-a-token", origin: serverOrigin },
      data: { title: "e2e PAT 专题" },
    });
    expect(pat.status()).toBe(403);

    // 卸载 → 素材区回空态(可重添加,不做确认步)
    await page.getByRole("button", { name: "卸载" }).click();
    await expect(page.getByText("还没有素材")).toBeVisible({ timeout: 10_000 });

    // 产出动作防线(M42:两个动作恒在,与主意图无关;空素材就地拦截,零真网):
    // UI 点生成长文 → 空素材人话行内回显,不开抽屉。写库防线在工具层
    // (save_topic_draft admin 会话校验),API 轮询路由已随管线退役删除
    await expect(page.getByRole("button", { name: "生成贴图" })).toBeVisible();
    await page.getByRole("button", { name: "生成长文" }).click();
    await expect(page.getByText("还没有素材——先添加 2~3 条解读/文章/电报,再来创作")).toBeVisible({
      timeout: 10_000,
    });

    // M44 状态驱动交互(零 LLM):空产出舞台=三步引导卡(post/pin 各一,步骤①
    // 挂素材=当前步骤);创作条标题态机空素材=「先准备素材」;轮询接口裸快照与
    // [id] 路由守卫同款(会话 200 / PAT 403)
    await expect(page.getByText("先挂载素材,再开始创作")).toHaveCount(2);
    await expect(page.getByText("当前步骤")).toHaveCount(2);
    await expect(page.getByText("先准备素材")).toBeVisible();
    const snap = await page.request.get(`/api/topics/${topicId}/studio-state/`);
    expect(snap.status()).toBe(200);
    const snapBody = (await snap.json()) as {
      data: { status: string; linkedPostId: string | null; pinIds: string[] };
    };
    expect(snapBody.data.status).toBe("drafted");
    expect(snapBody.data.linkedPostId).toBeNull();
    expect(snapBody.data.pinIds).toEqual([]);
    const patSnap = await request.get(`/api/topics/${topicId}/studio-state/`, {
      headers: { authorization: "Bearer e2e-not-a-token" },
    });
    expect(patSnap.status()).toBe(403);

    // 贴图产出卡(M42):topic_id 软关联的贴图在产出区列出,入口直通组装台
    await prisma.contentPin.create({
      data: {
        title: PIN_TITLE,
        topicId: BigInt(topicId),
        status: "draft",
        images: {
          create: [{ mediaPath: "/wp-content/uploads/e2e/studio-pin-1.png", sortOrder: 0 }],
        },
      },
    });
    await page.reload();
    // v2 工作台:刷新后舞台按主意图落「长文」页签,切「贴图」看产出网格
    await page.getByRole("button", { name: /^贴图/ }).click();
    await expect(page.getByText(PIN_TITLE)).toBeVisible();
    await expect(page.getByRole("link", { name: "去组装台" })).toBeVisible();
    await expect(page.getByRole("button", { name: "再生成一组贴图" })).toBeVisible();

    // 删除创作(M46 验收补:v2 重构丢失删除入口):未知 id 404 防线 + UI 全流
    // (顶栏钮带后果确认,确认后 DELETE 成功跳回列表,卡消失)
    const delMissing = await page.request.delete(`/api/topics/999999999/`, { headers: origin });
    expect(delMissing.status()).toBe(404);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "删除创作" }).click();
    await page.waitForURL(/\/admin\/studio\/?$/, { timeout: 10_000 });
    await expect(page.getByText(TOPIC_TITLE)).toHaveCount(0);
  } finally {
    await prisma.contentPin.deleteMany({ where: { title: PIN_TITLE } });
    await prisma.topic.deleteMany({ where: { title: TOPIC_TITLE } });
    await prisma.telegram.deleteMany({
      where: { sourceId: source.id, title: { in: [TG_DONE, TG_PENDING] } },
    });
  }
});

test("35. 编辑器自动保存与编辑上下文(M27 批①:debounce 落库/乐观锁 409/影子恢复/助手 chip/published 不自动存,零真 LLM)", async ({
  page,
}) => {
  const MARK = "e2e-autosave";
  const category = await prisma.category.upsert({
    where: { slug: "e2e-autosave" },
    // 名字避含「自动保存」:④ 断言 published 页无自动保存字样,select 选项也算命中
    update: { name: "e2e autosave fixture" },
    create: { slug: "e2e-autosave", name: "e2e autosave fixture" },
  });
  await prisma.post.deleteMany({ where: { slug: { startsWith: MARK } } });
  const draft = await prisma.post.create({
    data: {
      slug: `${MARK}-draft`,
      title: "e2e 自动保存草稿",
      contentMd: "e2e 自动保存正文 v1。",
      categoryId: category.id,
      status: "draft",
    },
  });
  const published = await prisma.post.create({
    data: {
      slug: `${MARK}-pub`,
      title: "e2e 自动保存已发布",
      contentMd: "e2e 已发布正文。",
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(),
    },
  });
  let putSeen = false;
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/api/posts/")) putSeen = true;
  });

  try {
    await e2eAdminLogin(page);

    // ① debounce 自动保存:改标题 → PUT(≤10s)→ 「已自动保存」状态行 + 库内落库
    await page.goto(`/admin/posts/${draft.id}`);
    await page.getByPlaceholder("文章标题…").fill("e2e 自动保存草稿·改");
    await page.waitForRequest(
      (r) => r.method() === "PUT" && r.url().includes(`/api/posts/${draft.id}`),
      { timeout: 10_000 },
    );
    await expect(page.getByText(/已自动保存/)).toBeVisible({ timeout: 10_000 });
    const savedRow = await prisma.post.findUniqueOrThrow({ where: { id: draft.id } });
    expect(savedRow.title).toBe("e2e 自动保存草稿·改");

    // ② 乐观锁:他端绕锁直改(无 expectedUpdatedAt,MCP 同形)→ UI 再改 → 自动保存
    //    409 → 人话横幅 + 自动保存暂停(再改无新 PUT)
    await page.request.put(`/api/posts/${draft.id}`, {
      headers: jsonOrigin(page),
      data: {
        title: "e2e 自动保存草稿·他端改",
        categorySlug: "e2e-autosave",
        contentMd: "e2e 他端写入正文。",
        contentOrigin: "human",
      },
    });
    await page.getByPlaceholder("文章标题…").fill("e2e 自动保存草稿·冲突拍");
    await expect(page.getByText(/文章已在其他端被修改/)).toBeVisible({ timeout: 10_000 });
    putSeen = false;
    await page.getByPlaceholder("文章标题…").fill("e2e 自动保存草稿·冲突拍2");
    await page.waitForTimeout(3500); // 越过 debounce 窗:enabled=false 不应再发 PUT
    expect(putSeen).toBe(false);

    // ③ 乐观锁 API 口径:旧基准 409(带 reason);当前基准 200 且回传新 updatedAt
    const cur = await prisma.post.findUniqueOrThrow({ where: { id: draft.id } });
    const stale = await page.request.put(`/api/posts/${draft.id}`, {
      headers: jsonOrigin(page),
      data: {
        title: "e2e 旧基准",
        categorySlug: "e2e-autosave",
        contentMd: "e2e 旧基准正文。",
        contentOrigin: "human",
        expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(stale.status()).toBe(409);
    const staleBody = (await stale.json()) as { data?: { reason?: string }; message: string };
    expect(staleBody.data?.reason).toBe("stale_update");
    expect(staleBody.message).toContain("其他端");
    const fresh = await page.request.put(`/api/posts/${draft.id}`, {
      headers: jsonOrigin(page),
      data: {
        title: "e2e 新基准",
        categorySlug: "e2e-autosave",
        contentMd: "e2e 新基准正文。",
        contentOrigin: "human",
        expectedUpdatedAt: cur.updatedAt.toISOString(),
      },
    });
    expect(fresh.status()).toBe(200);
    const freshBody = (await fresh.json()) as { data?: { updatedAt?: string } };
    expect(freshBody.data?.updatedAt).toBeTruthy();

    // ④ published 不自动保存(手动口径不变):改动越过 debounce 窗无 PUT、无自动存状态行
    await page.goto(`/admin/posts/${published.id}`);
    putSeen = false;
    await page.getByPlaceholder("文章标题…").fill("e2e 已发布·手动改");
    await page.waitForTimeout(3500);
    expect(putSeen).toBe(false);
    await expect(page.getByText(/自动保存/)).toHaveCount(0);

    // ⑤ 影子副本恢复:preset 比库内新的影子 → 挂载提示 → 恢复写回编辑器
    const shadow = {
      title: "e2e 影子标题",
      contentMd: "e2e 影子正文:崩溃前未及保存的修改。",
      at: new Date(Date.now() + 60_000).toISOString(), // 恒新于库内 updatedAt
    };
    await page.goto("/");
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [`ah:editor:shadow:${published.id}`, JSON.stringify(shadow)],
    );
    await page.goto(`/admin/posts/${published.id}`);
    await expect(page.getByText(/检测到未保存的本地修改/)).toBeVisible();
    await page.getByRole("button", { name: "恢复" }).click();
    await expect(page.getByPlaceholder("文章标题…")).toHaveValue("e2e 影子标题");
    // 正文恢复走前台预览断言(ArticleBody 直读 state;Vditor 异步初始化不做值断言面)
    await page.getByRole("button", { name: "前台预览" }).click();
    await expect(page.getByText(/崩溃前未及保存的修改/)).toBeVisible();
    // 影子按设计保留至保存成功;此处测试链无保存,显式清底防串扰
    await page.evaluate(
      ([key]) => window.localStorage.removeItem(key),
      [`ah:editor:shadow:${published.id}`],
    );

    // ⑥ 编辑上下文注入:AI 助手钮开卡 → chip 呈现当前编辑文(零 LLM 调用,只开卡)
    await page.goto(`/admin/posts/${draft.id}`);
    await page.getByRole("button", { name: "AI 助手" }).click();
    await expect(page.getByRole("dialog", { name: "AI 助手" })).toBeVisible();
    await expect(page.getByText(/正在编辑:/)).toBeVisible();
    await expect(page.getByText(/《e2e 新基准》/)).toBeVisible();
    await page.getByRole("button", { name: "收起", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "AI 助手" })).toHaveCount(0);
  } finally {
    await prisma.post.deleteMany({ where: { slug: { startsWith: MARK } } });
  }
});

test("36. 助手会话列表常驻化(M27 批⑧-a:member 常驻左栏/搜索过滤/切换回查/编辑路由 FAB 藏钮不卸卡(M35)/游客单列不回归,零真 LLM)", async ({
  page,
}) => {
  await e2eAdminLogin(page);
  const admin = await prisma.userAccount.findUniqueOrThrow({ where: { phone: E2E_ADMIN_PHONE } });
  const mark = `e2e-sess-${Date.now()}`;
  const s1 = await prisma.searchAgentSession.create({
    data: { id: randomUUID(), visitorId: `admin:${admin.id}`, title: `${mark} 甲会话` },
  });
  const s2 = await prisma.searchAgentSession.create({
    data: { id: randomUUID(), visitorId: `admin:${admin.id}`, title: `${mark} 乙会话` },
  });
  const category = await prisma.category.upsert({
    where: { slug: "e2e-autosave" },
    update: { name: "e2e autosave fixture" },
    create: { slug: "e2e-autosave", name: "e2e autosave fixture" },
  });
  const draft = await prisma.post.create({
    data: {
      slug: `${mark}-draft`,
      title: "e2e 会话列表草稿",
      contentMd: "e2e 会话列表正文。",
      categoryId: category.id,
      status: "draft",
    },
  });
  try {
    // ① 编辑路由 FAB 藏钮不卸卡(M35 路由策略;new 页仍在):/admin/posts/new 有 FAB,编辑页无
    await page.goto("/admin/posts/new");
    await expect(page.getByRole("button", { name: "打开 AI 助手" })).toBeVisible();
    await page.goto(`/admin/posts/${draft.id}`);
    await expect(page.getByRole("button", { name: "打开 AI 助手" })).toHaveCount(0);

    // ② 常驻左栏:顶栏助手钮开卡 → 会话侧栏在位(新会话钮 + 搜索框 + 分组列表)
    await page.getByRole("button", { name: "AI 助手" }).click();
    const dialog = page.getByRole("dialog", { name: "AI 助手" });
    await expect(dialog).toBeVisible();
    // 真 <button> 定位:会话行是 div[role=button],历史库空标题会话的默认文案
    // 同为「新会话」,getByRole(name) 会 strict 冲突——按元素名过滤掉行节点
    await expect(dialog.locator("button").filter({ hasText: "新会话" })).toBeVisible();
    await expect(dialog.getByPlaceholder("搜索会话")).toBeVisible();
    // 宽屏汉堡钮退役(sm:hidden 在 DOM 但不可见)
    await expect(dialog.getByRole("button", { name: "会话列表" })).toBeHidden();
    await expect(dialog.getByText(`${mark} 甲会话`)).toBeVisible();
    await expect(dialog.getByText(`${mark} 乙会话`)).toBeVisible();

    // ③ 搜索过滤:命中甲则乙不显;清词恢复
    await dialog.getByPlaceholder("搜索会话").fill("甲会话");
    await expect(dialog.getByText(`${mark} 甲会话`)).toBeVisible();
    await expect(dialog.getByText(`${mark} 乙会话`)).toBeHidden();
    await dialog.getByPlaceholder("搜索会话").fill("");

    // ④ 切换回查:点甲会话 → 拉取该线程 checkpoint state(历史会话可回查)
    const stateReq = page.waitForRequest((r) =>
      r.url().includes(`/api/search/agent/threads/${s1.id}/state`),
    );
    await dialog.getByText(`${mark} 甲会话`).click();
    await stateReq;

    // ⑤ 游客单列不回归:独立无痕上下文,前台 FAB 开卡无常驻左栏/新会话钮
    const ctx = await page.context().browser()!.newContext();
    const gpage = await ctx.newPage();
    await gpage.goto("/");
    await gpage.getByRole("button", { name: "打开 AI 助手" }).click();
    const gdialog = gpage.getByRole("dialog", { name: "AI 助手" });
    await expect(gdialog).toBeVisible();
    await expect(gdialog.locator("button").filter({ hasText: "新会话" })).toHaveCount(0);
    await ctx.close();
  } finally {
    await prisma.searchAgentSession.deleteMany({
      where: { id: { in: [s1.id, s2.id] } },
    });
    await prisma.post.deleteMany({ where: { slug: { startsWith: mark } } });
  }
});

test("37. 飞书免登底座(M29 批①②:登录页非飞书零回归/exchange 未启用 403/status 凭证齐透传+未配置 403/bind 未登录 401,零真网)", async ({
  page,
  request,
}) => {
  // mutation 同源 Origin 运行时派生(e2e 可在备用端口起服,写死 :3000 会 403)
  const SITE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  // 共享单例行快照恢复(与集成测试同纪律:测前快照,finally 原样还原)
  const snap = await prisma.adminFeishuConfig.findUnique({ where: { id: 1 } });
  const quotaKeys = ["auth:feishu:exch:203.0.113.91"];
  try {
    // 37.1 登录页(普通浏览器 UA)→ 密码表单在位、无免登横幅(非飞书渲染 null,零回归)
    await page.goto("/admin/login/");
    await expect(page.getByPlaceholder("手机号 / 用户名 / 邮箱")).toBeVisible();
    await expect(page.getByText("正在通过飞书免登")).toHaveCount(0);

    // 37.2 配置了凭证但未启用 → exchange 403(不触飞书;未启用门在兑换之前)。
    // appSecretEnc 须为真密文:status/兑换链经 getFeishuRuntimeConfig 解密,
    // 解密失败归 null 会误触「未配置」fail-closed(动态 import——env 校验在
    // loadEnvConfig 之后才可求值,静态引会炸)
    const { encryptSecret } = await import("../../src/lib/crypto/secret-box");
    const appSecretEnc = encryptSecret("smoke-e2e-secret");
    await prisma.adminFeishuConfig.upsert({
      where: { id: 1 },
      update: {
        appId: "cli_e2e_smoke",
        appSecretEnc,
        appSecretMask: "sm****",
        enabled: false,
      },
      create: {
        id: 1,
        appId: "cli_e2e_smoke",
        appSecretEnc,
        appSecretMask: "sm****",
        enabled: false,
      },
    });
    const off = await request.post("/api/auth/feishu/exchange/", {
      headers: {
        "content-type": "application/json",
        origin: SITE,
        "x-forwarded-host": new URL(SITE).host,
        "x-forwarded-for": "203.0.113.91",
      },
      data: { code: "e2e-code" },
    });
    expect(off.status()).toBe(403);

    // 37.3 凭证齐(未启用)→ status 透传 appId+enabled(H5 免登取 appId 入口,零出网)
    const st = await request.get("/api/auth/feishu/status/");
    expect(st.status()).toBe(200);
    const stBody = (await st.json()) as { code: number; data: { enabled: boolean; appId: string } };
    expect(stBody.code).toBe(0);
    expect(stBody.data).toEqual({ enabled: false, appId: "cli_e2e_smoke" });

    // 37.4 行删除(未配置)→ status 403 fail-closed;bind API 未登录 401
    await prisma.adminFeishuConfig.deleteMany({ where: { id: 1 } });
    const blank = await request.get("/api/auth/feishu/status/");
    expect(blank.status()).toBe(403);
    const bindAnon = await request.get("/api/admin/feishu/bind/");
    expect(bindAnon.status()).toBe(401);
  } finally {
    if (snap) {
      await prisma.adminFeishuConfig.update({
        where: { id: 1 },
        data: {
          appId: snap.appId,
          appSecretEnc: snap.appSecretEnc,
          appSecretMask: snap.appSecretMask,
          enabled: snap.enabled,
        },
      });
    } else {
      await prisma.adminFeishuConfig.deleteMany({ where: { id: 1 } });
    }
    for (const k of quotaKeys) await e2eRedis.del(k);
  }
});

test("38. Agent 技能(M30 批④:技能页 CRUD 冒烟/key 建后不可改/启停落库/技能路由派生与软引用防线/非法 skillKey 400,零真网)", async ({
  page,
}) => {
  const KEY = "e2e-skill-m30";
  const NAME = "e2e 技能·冒烟";
  const SCENARIO = "e2e 冒烟场景:验证技能调度取用面";
  const GUIDE = "- e2e 指南条目:开头直给结论,不写「随着…的发展」式套话\n- 结构:两段递进";
  const TOPIC_TITLE = "e2e 专题-技能绑定";
  // 自清理:重跑幂等(agent_skill.key 唯一;topic 按标题)
  await prisma.agentSkill.deleteMany({ where: { key: KEY } });
  await prisma.topic.deleteMany({ where: { title: TOPIC_TITLE } });
  const topic = await prisma.topic.create({ data: { title: TOPIC_TITLE } });
  page.once("dialog", (d) => d.accept()); // 行删除 confirm 自动接受

  try {
    await e2eAdminLogin(page);

    // 38.1 「写作技能」独立页(M39 批① 自模型页第 4 页签提升):UI 新增技能
    //      (全字段)→ 台账行落位,库内 enabled=true
    await page.goto("/admin/skills/");
    await expect(page.getByRole("heading", { name: "写作技能" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ 新增技能" })).toBeVisible();
    await page.getByRole("button", { name: "+ 新增技能" }).click();
    await page.getByPlaceholder("如 blogger-video").fill(KEY);
    await page.getByPlaceholder("如:博主×视频推荐短文").fill(NAME);
    await page.getByPlaceholder("如:公众号「博主×视频」推荐短文(专题合成默认场景)").fill(SCENARIO);
    await page.getByPlaceholder(/开头钩子不超过 80 字/).fill(GUIDE);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    const row = page.getByRole("row", { name: new RegExp(KEY) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText(NAME);
    const created = await prisma.agentSkill.findUniqueOrThrow({ where: { key: KEY } });
    expect(created.enabled).toBe(true);
    expect(created.guideMd).toBe(GUIDE);
    expect(created.scenario).toBe(SCENARIO);

    // 38.2 编辑弹窗:key 输入 disabled(建后不可改,agent 稳定引用);改名落库
    await row.getByRole("button", { name: "编辑" }).click();
    await expect(page.getByPlaceholder("如 blogger-video")).toBeDisabled();
    await expect(page.getByPlaceholder("如 blogger-video")).toHaveValue(KEY);
    await page.getByPlaceholder("如:博主×视频推荐短文").fill(`${NAME}·改`);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("row", { name: new RegExp(KEY) })).toContainText("·改", {
      timeout: 10_000,
    });
    const renamed = await prisma.agentSkill.findUniqueOrThrow({ where: { key: KEY } });
    expect(renamed.name).toBe(`${NAME}·改`);

    // 38.3 启停 switch:关 → enabled=false 落库;再开 → 恢复(绑定 select 只列启用技能)
    await row.getByRole("switch", { name: /启用 e2e 技能/ }).click();
    await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "false", {
      timeout: 10_000,
    });
    expect((await prisma.agentSkill.findUniqueOrThrow({ where: { key: KEY } })).enabled).toBe(
      false,
    );
    // 停用态软引用防线:显式绑定指向停用技能 → 400(不落库)
    const bindOff = await page.request.patch(`/api/topics/${topic.id}/`, {
      headers: jsonOrigin(page),
      data: { skillKey: KEY },
    });
    expect(bindOff.status()).toBe(400);
    expect(((await bindOff.json()) as { message: string }).message).toContain("skillKey");
    await row.getByRole("switch", { name: /启用 e2e 技能/ }).click();
    await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true", {
      timeout: 10_000,
    });

    // 38.4 技能路由(M39 批② 派生制;详情页「绑定写作技能」select 随 §13.8
    //      退役):显式 skillKey 软引用落位;定位命中预置形式 → 派生覆盖;
    //      显式解绑 → null
    const bindPut = await page.request.patch(`/api/topics/${topic.id}/`, {
      headers: jsonOrigin(page),
      data: { skillKey: KEY },
    });
    expect(bindPut.status()).toBe(200);
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } })).skillKey).toBe(KEY);
    const derived = await page.request.patch(`/api/topics/${topic.id}/`, {
      headers: jsonOrigin(page),
      data: {
        positioning: composeWritingText({
          form: "model-pricing",
          tone: "friendly",
          length: "standard",
          visual: "illustrate",
          cover: "generate",
        }),
      },
    });
    expect(derived.status()).toBe(200);
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } })).skillKey).toBe(
      "model-pricing",
    );
    const unbind = await page.request.patch(`/api/topics/${topic.id}/`, {
      headers: jsonOrigin(page),
      data: { skillKey: null },
    });
    expect(unbind.status()).toBe(200);
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } })).skillKey).toBeNull();

    // 38.5 服务端防线:PATCH 不存在的 skillKey → 400 人话包络(不落库)
    const bad = await page.request.patch(`/api/topics/${topic.id}/`, {
      headers: jsonOrigin(page),
      data: { skillKey: "e2e-no-such-skill" },
    });
    expect(bad.status()).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toContain("skillKey");
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } })).skillKey).toBeNull();
  } finally {
    await prisma.topic.deleteMany({ where: { title: TOPIC_TITLE } });
    await prisma.agentSkill.deleteMany({ where: { key: KEY } });
  }
});

test("39. Agent 宿主唯一化(M35:协议唤起开卡/跨页常驻 run 不断面/编辑页登录页藏钮不卸卡/ask 预填不直发,零真 LLM)", async ({
  page,
}) => {
  await e2eAdminLogin(page);
  const category = await prisma.category.upsert({
    where: { slug: "e2e-autosave" },
    update: { name: "e2e autosave fixture" },
    create: { slug: "e2e-autosave", name: "e2e autosave fixture" },
  });
  const mark = `e2e-host-${Date.now()}`;
  const draft = await prisma.post.create({
    data: {
      slug: `${mark}-draft`,
      title: "e2e 宿主唯一化草稿",
      contentMd: "e2e 宿主唯一化正文。",
      categoryId: category.id,
      status: "draft",
    },
  });
  try {
    // ① 懒挂载:创作中心初始无卡;协议唤起(agent:open 空 detail)开卡
    await page.goto("/admin/studio");
    await expect(page.getByRole("dialog", { name: "AI 助手" })).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("agent:open", { detail: {} })));
    const dialog = page.getByRole("dialog", { name: "AI 助手" });
    await expect(dialog).toBeVisible();

    // ② 宿主跨页常驻(M35 核心断言):侧栏 next/link 客户端切页 → 卡仍在
    //    (旧实现页面自持卡在此处随路由卸载,run 被服务端 abort——M31 验收事故)
    await page.getByRole("link", { name: "文章管理" }).click();
    await expect(page).toHaveURL(/\/admin\/posts\/?$/);
    await expect(dialog).toBeVisible();

    // ③ 协议 ask 注入(send:false=仅预填输入框,不直发 → 零 LLM 调用)
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("agent:open", {
          detail: { ask: { question: "e2e 宿主唤起预填", send: false } },
        }),
      ),
    );
    await expect(dialog.getByPlaceholder(/继续深挖/)).toHaveValue("e2e 宿主唤起预填");

    // ④ 编辑页藏钮不卸卡(FAB 整页 reload 后懒挂载重置,顶栏入口开的是宿主卡):
    //    FAB 钮 count 0(路由策略),顶栏「AI 助手」开卡 → chip 在场(能力注册)
    await page.goto(`/admin/posts/${draft.id}`);
    await expect(page.getByRole("button", { name: "打开 AI 助手" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "AI 助手" })).toHaveCount(0);
    await page.getByRole("button", { name: "AI 助手" }).click();
    await expect(page.getByRole("dialog", { name: "AI 助手" })).toBeVisible();
    await expect(page.getByText(/正在编辑:/)).toBeVisible();
    await expect(page.getByText(/《e2e 宿主唯一化草稿》/)).toBeVisible();

    // ⑤ 编辑页顶栏入口开的也是宿主卡:客户端切页(侧栏 → 站点统计)卡不卸载,
    //    能力注销 → chip 消失(run 语义:编辑面接线不在场,评审降级既有语义)
    await page.getByRole("navigation").getByRole("link", { name: "站点统计" }).click();
    await expect(page).toHaveURL(/\/admin\/?$/);
    await expect(page.getByRole("dialog", { name: "AI 助手" })).toBeVisible();
    await expect(page.getByText(/正在编辑:/)).toHaveCount(0);

    // ⑥ 登录页全隐:无 FAB 钮、无唤起点(登录流程聚焦)
    await page.goto("/admin/login");
    await expect(page.getByRole("button", { name: "打开 AI 助手" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "唤起 AI 助手" })).toHaveCount(0);
  } finally {
    await prisma.post.deleteMany({ where: { slug: { startsWith: mark } } });
  }
});

test("40. 模板实验室退役防线(M39 移除 /admin/cards 页:页面 404;预览 API 独活、非法 preset 400,零真网)", async ({
  page,
}) => {
  await e2eAdminLogin(page);

  // ① 模板实验室页已随 M39 退役:登录态访问直落 404(默认 not-found)
  const gone = await page.goto("/admin/cards/");
  expect(gone?.status()).toBe(404);

  // ② 预览 API 独活(仅 POST + admin 会话):非法 preset 400(Zod enum 校验,
  //    不触真实渲染——card-renderer 8011 未对宿主机发布,渲染链路留真机验收)
  const bad = await page.request.post("/api/card-presets/preview/", {
    headers: { "content-type": "application/json", origin: originOf(page) },
    data: { preset: "not-a-preset", data: {} },
  });
  expect(bad.status()).toBe(400);
});

test("41. 样例参照图库与写作配置回写(M39 批③⑤:图库路由鉴权/上传边界/重命名删除软引用/topic 绑定核/五形式 skillKey 回写,零真网)", async ({
  page,
  request,
}) => {
  const TOPIC_TITLE = "e2e 专题-样例参照图";
  await prisma.topic.deleteMany({ where: { title: TOPIC_TITLE } });
  await prisma.writingSampleImage.deleteMany({ where: { name: { startsWith: "e2e " } } });
  const png = await sharp({
    create: { width: 4, height: 3, channels: 3, background: { r: 30, g: 144, b: 255 } },
  })
    .png()
    .toBuffer();

  try {
    // ① 未登录防线:GET 401;mutation 跨域 Origin 403(同源关先于会话)、同源 Origin 401
    await page.goto("/");
    expect((await request.get("/api/writing-samples/")).status()).toBe(401);
    const cross = await request.post("/api/writing-samples/", {
      headers: { "content-type": "application/json", origin: "https://evil.example" },
    });
    expect(cross.status()).toBe(403);
    expect(
      (
        await request.post("/api/writing-samples/", {
          headers: { "content-type": "application/json", origin: originOf(page) },
        })
      ).status(),
    ).toBe(401);
    const crossTopic = await request.patch("/api/topics/1/", {
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      data: { sampleImageId: "1" },
    });
    expect(crossTopic.status()).toBe(403);

    // ② 登录后上传边界:缺文件字段 400(JSON body 打 multipart 路由由 Next 415 挡,
    //    不进路由校验)/ 非图片魔数 415(媒体域 unsupported 既有口径)/ 超 6MB 400 /
    //    合法 202(展示名=文件名去扩展)
    await e2eAdminLogin(page);
    const origin = jsonOrigin(page);
    const sampleOrigin = { origin: originOf(page) };
    const noField = await page.request.post("/api/writing-samples/", {
      headers: sampleOrigin,
      multipart: {
        notfile: { name: "e2e-x.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
      },
    });
    expect(noField.status()).toBe(400);
    expect(await noField.text()).toContain("缺少文件字段");
    const notImg = await page.request.post("/api/writing-samples/", {
      headers: sampleOrigin,
      multipart: {
        file: { name: "e2e-fake.png", mimeType: "image/png", buffer: Buffer.from("not an image") },
      },
    });
    expect(notImg.status()).toBe(415);
    const oversize = await page.request.post("/api/writing-samples/", {
      headers: sampleOrigin,
      multipart: {
        file: {
          name: "e2e-big.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(6 * 1024 * 1024 + 1, 7),
        },
      },
    });
    expect(oversize.status()).toBe(400);
    expect(await oversize.text()).toContain("6MB");
    const up = await page.request.post("/api/writing-samples/", {
      headers: sampleOrigin,
      multipart: { file: { name: "e2e 参照样例风格.png", mimeType: "image/png", buffer: png } },
    });
    expect(up.status()).toBe(202);
    const upBody = (await up.json()) as {
      code: number;
      data: { id: string; name: string; mediaPath: string };
    };
    expect(upBody.code).toBe(0);
    expect(upBody.data.name).toBe("e2e 参照样例风格");
    expect(upBody.data.mediaPath).toMatch(/^\/wp-content\/uploads\//);
    const sampleId = upBody.data.id;

    // ③ sha1 去重:同字节重传 reused,媒体同路径、图库另起新行
    const reup = await page.request.post("/api/writing-samples/", {
      headers: sampleOrigin,
      multipart: { file: { name: "e2e 参照样例风格.png", mimeType: "image/png", buffer: png } },
    });
    expect(reup.status()).toBe(202);
    const reupBody = (await reup.json()) as {
      message: string;
      data: { id: string; mediaPath: string };
    };
    expect(reupBody.message).toBe("reused");
    expect(reupBody.data.mediaPath).toBe(upBody.data.mediaPath);
    expect(reupBody.data.id).not.toBe(sampleId);

    // ④ 清单含新行
    const list = await page.request.get("/api/writing-samples/");
    const listBody = (await list.json()) as {
      data: { samples: Array<{ id: string }> };
    };
    expect(listBody.data.samples.some((s) => s.id === sampleId)).toBe(true);

    // ⑤ 重命名与校验:空名/超长 400、非法 id 400、不存在 404
    const renamed = await page.request.patch(`/api/writing-samples/${sampleId}/`, {
      headers: origin,
      data: { name: "e2e 重命名风格" },
    });
    expect(renamed.status()).toBe(200);
    expect(((await renamed.json()) as { data: { name: string } }).data.name).toBe("e2e 重命名风格");
    expect(
      (
        await page.request.patch(`/api/writing-samples/${sampleId}/`, {
          headers: origin,
          data: { name: "" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.patch(`/api/writing-samples/${sampleId}/`, {
          headers: origin,
          data: { name: "x".repeat(101) },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.patch("/api/writing-samples/abc/", {
          headers: origin,
          data: { name: "x" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.patch("/api/writing-samples/99999999/", {
          headers: origin,
          data: { name: "x" },
        })
      ).status(),
    ).toBe(404);

    // ⑥ topic 绑定核:绑定回读;不存在 400(存在性核);非法 id 400
    const topic = await prisma.topic.create({ data: { title: TOPIC_TITLE } });
    const topicId = topic.id.toString();
    const bind = await page.request.patch(`/api/topics/${topicId}/`, {
      headers: origin,
      data: { sampleImageId: sampleId },
    });
    expect(bind.status()).toBe(200);
    expect(
      ((await bind.json()) as { data: { sampleImageId: string | null } }).data.sampleImageId,
    ).toBe(sampleId);
    const noSample = await page.request.patch(`/api/topics/${topicId}/`, {
      headers: origin,
      data: { sampleImageId: "99999999" },
    });
    expect(noSample.status()).toBe(400);
    expect(await noSample.text()).toContain("样例参照图不存在");
    expect(
      (
        await page.request.patch(`/api/topics/${topicId}/`, {
          headers: origin,
          data: { sampleImageId: "abc" },
        })
      ).status(),
    ).toBe(400);

    // ⑦ writing-config 五形式 roundtrip:价格表模板 + 文生图图文条款 → skillKey 同请求回写;
    //   手写补充 → custom,派生 undefined 不触碰既有绑定(2026-10-20 重构口径)
    const pricing = composeWritingText({
      form: "model-pricing",
      tone: "friendly",
      length: "standard",
      visual: "illustrate",
      cover: "generate",
    });
    const cfg = await page.request.patch(`/api/topics/${topicId}/`, {
      headers: origin,
      data: { positioning: pricing },
    });
    expect(cfg.status()).toBe(200);
    expect(((await cfg.json()) as { data: { skillKey: string | null } }).data.skillKey).toBe(
      "model-pricing",
    );
    const customed = await page.request.patch(`/api/topics/${topicId}/`, {
      headers: origin,
      data: { positioning: `${pricing}\n补充:多列一手实测价格` },
    });
    expect(customed.status()).toBe(200);
    expect(((await customed.json()) as { data: { skillKey: string | null } }).data.skillKey).toBe(
      "model-pricing",
    );

    // ⑧ 删行软引用:绑定事务置空(媒体不连带);再删 404
    const del = await page.request.delete(`/api/writing-samples/${sampleId}/`, {
      headers: origin,
    });
    expect(del.status()).toBe(200);
    expect(((await del.json()) as { data: { deleted: boolean } }).data.deleted).toBe(true);
    const afterDel = await page.request.get(`/api/topics/${topicId}/`);
    expect(
      ((await afterDel.json()) as { data: { sampleImageId: string | null } }).data.sampleImageId,
    ).toBeNull();
    expect(
      (
        await page.request.delete(`/api/writing-samples/${sampleId}/`, { headers: origin })
      ).status(),
    ).toBe(404);
  } finally {
    await prisma.topic.deleteMany({ where: { title: TOPIC_TITLE } });
    await prisma.writingSampleImage.deleteMany({ where: { name: { startsWith: "e2e " } } });
    // 样例媒体行与盘上文件族一并清:样例删除按设计不连带媒体(⑧ 口径),
    // 残留孤儿行会与用例 7 的样图同字节 sha1 相撞吞掉 7 号上传(数据态耦合)
    const leftover = await prisma.media.findMany({
      where: { filename: "e2e 参照样例风格.png" },
    });
    const mediaRoot = path.resolve(process.cwd(), process.env.MEDIA_DIR ?? "workspace/media");
    for (const m of leftover) {
      const rel = decodeURIComponent(m.path.replace("/wp-content/uploads/", ""));
      const stem = rel.replace(/\.[a-z]+$/, "");
      await Promise.all(
        [rel, `${stem}.webp`, `${stem}.thumb.webp`].map((f) =>
          rm(path.join(mediaRoot, f), { force: true }),
        ),
      );
      await prisma.media.delete({ where: { id: m.id } });
    }
  }
});
