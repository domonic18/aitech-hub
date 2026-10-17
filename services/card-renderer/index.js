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
 *
 * 资源:浏览器常驻单例(崩溃惰性重启);并发信号量 MAX_CONCURRENT,
 * 满员即刻 429(排队会让 Agent 工具白等,不如快速失败提示重试)。
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { isInsideMediaRoot, parseRenderBody, RAW_BODY_MAX_BYTES } from "./validate.js";

const PORT = Number(process.env.PORT ?? 8011);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT ?? 2);
// 媒体卷根(ro 挂载,与 web 容器 MEDIA_DIR 同卷):站内引图 file:// 内联的唯一根。
// 未设置(如本地裸跑)则 file:// 一律替换为占位图(不读盘)。
const MEDIA_ROOT = process.env.MEDIA_ROOT ? path.resolve(process.env.MEDIA_ROOT) : null;

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
function tryAcquire() {
  if (active >= MAX_CONCURRENT) return false;
  active += 1;
  return true;
}
function release() {
  active -= 1;
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
  if (req.method !== "POST" || req.url !== "/render") {
    sendJson(res, 404, { error: "仅支持 POST /render 与 GET /health" });
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
