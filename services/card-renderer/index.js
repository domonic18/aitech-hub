/**
 * card-renderer sidecar(M31 批②,2026-10-17 立项):HTML → PNG 专职渲染服务。
 *
 * 定位:与 douyin-gateway 同款 sidecar 模式,仅容器网内可达(不发布宿主端口),
 * web 容器经 CARD_RENDERER_URL 调用。浏览器渲染保全 CSS;上层消毒
 * (src/lib/card/sanitize.ts)已禁外链资源,本服务再做两层收口:
 * ① 站内引图(app 侧改写为 file://$MEDIA_ROOT/…)在 Node 侧读盘内联为
 *   data-URI(chromium 完全不触文件系统;路径包含校验+读失败占位,agent 无需 base64);
 * ② 请求级硬闸:仅放行 data:/about:blank,其余请求(导航/图片/字体/XHR)全 abort。
 * 页面 javaScriptEnabled=false,<script> 天然不执行。渲染期 SSRF/外联面归零。
 *
 * 契约:
 *   GET  /health  → 200 {ok:true,browser:"up"|"relaunching"}(compose healthcheck)
 *   POST /render  {html, width?, scale?, maxHeight?, timeoutMs?}
 *              → 200 image/png(X-Card-Width/X-Card-Height = 逻辑像素)
 *              → 400 校验失败 / 413 高度超限 / 429 忙 / 504 超时 / 500 渲染失败
 *   POST /snapshot {url, timeoutMs?, settleMs?, clickText?, screenshot?}(M56 批A:
 *              URL → 渲染后 HTML;JS 开启,RENDER_ALLOWED_HOSTS 白名单钉死 SSRF 面,
 *              未配置=403;screenshot=true 同时回传整页 PNG base64,P0 回溯档案)
 *              → 200 {html, finalUrl, httpStatus, png?}
 *
 * 资源:浏览器常驻单例(崩溃惰性重启;跑满 MAX_RUNS_PER_BROWSER 个 context
 * 主动弃置换新,防长跑退化——gateway chromium 自旋拖垮 VM 前科的对应纪律);
 * 并发信号量 MAX_CONCURRENT(两端点共享),满员即刻 429。
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import {
  isInsideMediaRoot,
  parseRenderBody,
  parseSnapshotBody,
  RAW_BODY_MAX_BYTES,
} from "./validate.js";

const PORT = Number(process.env.PORT ?? 8011);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT ?? 2);
// 媒体卷根(ro 挂载,与 web 容器 MEDIA_DIR 同卷):站内引图 file:// 内联的唯一根。
// 未设置(如本地裸跑)则 file:// 一律替换为占位图(不读盘)。
const MEDIA_ROOT = process.env.MEDIA_ROOT ? path.resolve(process.env.MEDIA_ROOT) : null;
// /snapshot URL 白名单(M56 批A,逗号分隔 host;未配置=端点禁用 403)。
// 渠道注册表内的官方页主机,防 JS 开启渲染被当 SSRF 跳板。
const RENDER_ALLOWED_HOSTS = (process.env.RENDER_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
// 进程级渲染轮次上限(防退化纪律,gateway chromium 自旋拖垮 VM 前科):
// 跑满 N 个 context 主动弃置浏览器,下次请求惰性重启换新进程内存。
const MAX_RUNS_PER_BROWSER = Number(process.env.MAX_RUNS_PER_BROWSER ?? 300);

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
/** 1x1 透明 GIF:引图不可用时的占位(渲染不因此整卡失败) */
const PLACEHOLDER_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * 站内引图内联:html 中的 file:///…(app 侧已按 MEDIA_ROOT 改写)读盘转 data-URI。
 * 路径包含校验(防遍历)→ 读文件 → 按扩展名定 mime;任何失败降级占位图,
 * chromium 永不直接触文件系统(about:blank 源默认禁 file:// 子资源,也无法绕过)。
 */
function inlineLocalMedia(html) {
  return html.replace(/file:\/\/\/[^"'\s)]+/gi, (url) => {
    if (!isInsideMediaRoot(MEDIA_ROOT, url)) return PLACEHOLDER_URI;
    try {
      const p = fileURLToPath(url);
      const mime = MIME_BY_EXT[path.extname(p).toLowerCase()];
      if (!mime) return PLACEHOLDER_URI;
      if (fs.statSync(p).size > 8 * 1024 * 1024) return PLACEHOLDER_URI;
      return `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
    } catch {
      return PLACEHOLDER_URI;
    }
  });
}

/** @type {import('playwright').Browser | null} */
let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });
  return browser;
}

/** 并发信号量:满员返回 false(fail-fast 429) */
let active = 0;
/** 浏览器累计渲染轮次(两端点共计数;满 MAX_RUNS_PER_BROWSER 弃置重启) */
let browserRuns = 0;
function tryAcquire() {
  if (active >= MAX_CONCURRENT) return false;
  active += 1;
  return true;
}
function release() {
  active -= 1;
  browserRuns += 1;
  if (browserRuns >= MAX_RUNS_PER_BROWSER && browser) {
    console.log(
      JSON.stringify({
        event: "renderer.browser_recycle",
        runs: browserRuns,
        max: MAX_RUNS_PER_BROWSER,
      }),
    );
    const stale = browser;
    browser = null;
    browserRuns = 0;
    void stale.close().catch(() => undefined); // 惰性重启:下次 getBrowser 拉新实例
  }
}

/**
 * 渲染单卡:独立 context(视口/拦截互不串扰),用毕即关。
 * @returns {Promise<{png: Buffer, width: number, height: number}>}
 */
async function renderCard({ html, width, scale, maxHeight, timeoutMs }) {
  const b = await getBrowser();
  const context = await b.newContext({
    viewport: { width, height: 600 },
    deviceScaleFactor: scale,
    javaScriptEnabled: false, // <script> 不执行;CDP evaluate 不受影响
    colorScheme: "light",
  });
  try {
    // 请求级硬闸:仅放行 data: 与 about:blank,其余(导航/图/字体/XHR)一律 abort
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("about:blank")) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    await page.setContent(inlineLocalMedia(html), { waitUntil: "load", timeout: timeoutMs });
    // 中文字体子集加载完再截,避免首帧豆腐块;fonts.ready 在 JS 禁用下仍可用
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height > maxHeight) {
      const err = new Error(
        `卡片渲染高度 ${height}px 超过上限 ${maxHeight}px:请拆成多张卡分别调用`,
      );
      err.statusCode = 413;
      throw err;
    }
    const png = await page.screenshot({ fullPage: true, type: "png", timeout: timeoutMs });
    return { png: Buffer.from(png), width, height };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * /snapshot(M56 批A):导航到白名单 URL,等 SPA 挂载后回传渲染后 HTML。
 * JS 开启(与 /render 相反——目标页是真实公开站点,需客户端渲染);
 * 不做请求拦截(子资源 CDN 与分析埋点照常,页首 load 后定时 settle 收尾,
 * 不用 networkidle——埋点长连会让它永不空闲)。
 * @returns {Promise<{html: string, finalUrl: string, httpStatus: number | null, png?: string}>}
 */
async function snapshotPage({ url, timeoutMs, settleMs, clickText, screenshot }) {
  const b = await getBrowser();
  const context = await b.newContext({
    viewport: { width: 1440, height: 900 },
    javaScriptEnabled: true,
    colorScheme: "light",
    locale: "zh-CN",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  try {
    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    if (clickText !== undefined) {
      // tab 切换(周期价格页):点击含该文本的元素;找不到不炸——返回当前态,
      // 由调用方按解析结果决定是否连败(页面改版可见优于静默空数据)
      await page
        .getByText(clickText, { exact: false })
        .first()
        .click({ timeout: 5000 })
        .catch(() => undefined);
    }
    // 自动滚底触发懒加载定价区(SPA 常见:视口外区块不挂载),再回顶。
    // 内部滚动容器(overflow:auto 的中栏布局)一并下滚——只看 document
    // 滚动的老逻辑对这类页面等于没滚,视口外区块永远不挂载。
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let y = 0;
          const step = () => {
            y += 600;
            window.scrollTo(0, y);
            for (const el of document.querySelectorAll("*")) {
              if (el.scrollHeight > el.clientHeight + 100) el.scrollTop = el.scrollHeight;
            }
            if (y < document.documentElement.scrollHeight + 600) setTimeout(step, 120);
            else {
              window.scrollTo(0, 0);
              resolve(undefined);
            }
          };
          step();
        }),
    );
    await page.waitForTimeout(settleMs); // SPA 挂载/懒加载收尾
    const html = await page.content();
    // 整页截图(P0 回溯档案):与 HTML 同一会话同一时刻,人看/比对都靠它。
    // 先回顶/复位内部滚动条(懒加载那一轮把中栏滚到了底),再量真实内容高:
    // SPA 把正文塞进内部滚动容器时 documentElement.scrollHeight 只有视口高
    // (1440x900),直接 fullPage 会截成半张——把视口撑到内容高再截。
    // 上限 15000px:超长页只保首屏 15000px,避免 PNG/base64 撑爆内存与传输。
    const png = screenshot
      ? await (async () => {
          const height = await page.evaluate(() => {
            window.scrollTo(0, 0);
            let max = document.documentElement.scrollHeight;
            for (const el of document.querySelectorAll("*")) {
              el.scrollTop = 0;
              if (el.scrollHeight > max) max = el.scrollHeight;
            }
            return max;
          });
          if (height > 900) {
            await page.setViewportSize({ width: 1440, height: Math.min(height, 15000) });
            await page.waitForTimeout(400); // 撑高后触发一次视口内懒加载
          }
          return (
            await page.screenshot({ fullPage: true, type: "png", timeout: timeoutMs })
          ).toString("base64");
        })()
      : undefined;
    return {
      html,
      finalUrl: page.url(),
      httpStatus: resp === null ? null : resp.status(),
      ...(png === undefined ? {} : { png }),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > RAW_BODY_MAX_BYTES) {
        reject(Object.assign(new Error("请求体超过 6MB 上限"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("请求体不是合法 JSON"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    void getBrowser()
      .then((b) => sendJson(res, 200, { ok: true, browser: b.isConnected() ? "up" : "up" }))
      .catch(() => sendJson(res, 503, { ok: false, browser: "down" }));
    return;
  }
  if (req.method === "POST" && req.url === "/snapshot") {
    if (!tryAcquire()) {
      sendJson(res, 429, { error: `渲染忙(并发上限 ${MAX_CONCURRENT}),请稍后重试` });
      return;
    }
    void (async () => {
      let params;
      try {
        const raw = await readJsonBody(req);
        const parsed = parseSnapshotBody(raw, RENDER_ALLOWED_HOSTS);
        if (!parsed.ok) {
          sendJson(res, parsed.status, { error: parsed.error });
          return;
        }
        params = parsed.value;
      } catch (e) {
        sendJson(res, e.statusCode ?? 400, { error: e.message });
        return;
      }
      try {
        const out = await snapshotPage(params);
        sendJson(res, 200, out);
      } catch (e) {
        const status = e.statusCode ?? (e.name === "TimeoutError" ? 504 : 500);
        sendJson(res, status, { error: e.message || "快照失败" });
      } finally {
        release();
      }
    })();
    return;
  }
  if (req.method !== "POST" || req.url !== "/render") {
    sendJson(res, 404, { error: "仅支持 POST /render、POST /snapshot 与 GET /health" });
    return;
  }
  if (!tryAcquire()) {
    sendJson(res, 429, { error: `渲染忙(并发上限 ${MAX_CONCURRENT}),请稍后重试` });
    return;
  }
  void (async () => {
    let params;
    try {
      const raw = await readJsonBody(req);
      const parsed = parseRenderBody(raw);
      if (!parsed.ok) {
        sendJson(res, parsed.status, { error: parsed.error });
        return;
      }
      params = parsed.value;
    } catch (e) {
      sendJson(res, e.statusCode ?? 400, { error: e.message });
      return;
    }
    try {
      const { png, width, height } = await renderCard(params);
      res.writeHead(200, {
        "content-type": "image/png",
        "x-card-width": String(width),
        "x-card-height": String(height),
      });
      res.end(png);
    } catch (e) {
      const status = e.statusCode ?? (e.name === "TimeoutError" ? 504 : 500);
      sendJson(res, status, { error: e.message || "渲染失败" });
    } finally {
      release();
    }
  })();
});

// 冷启动即拉浏览器:首个请求不吃 chromium 冷启延迟;失败不阻进程(健康检查可见)
void getBrowser().catch(() => undefined);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[card-renderer] listening on :${PORT}, max_concurrent=${MAX_CONCURRENT}`);
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    server.close(() => undefined);
    void browser?.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
