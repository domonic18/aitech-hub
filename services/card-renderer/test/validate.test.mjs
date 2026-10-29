/**
 * card-renderer 纯函数单测(node:test,零依赖,CI 直跑):
 * /render 入参校验边界 + file:// 媒体卷白名单(SSRF 硬闸的放行判定)。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HTML_MAX_CHARS,
  isInsideMediaRoot,
  parseRenderBody,
  parseSnapshotBody,
} from "../validate.js";

const ROOT = "/app/media";

test("parseRenderBody:缺 html/空 html 拒绝", () => {
  assert.equal(parseRenderBody(null).ok, false);
  assert.equal(parseRenderBody([]).ok, false);
  assert.equal(parseRenderBody({}).ok, false);
  assert.equal(parseRenderBody({ html: "   " }).ok, false);
});

test("parseRenderBody:缺省项补默认(width=900/scale=2/maxHeight=4000)", () => {
  const r = parseRenderBody({ html: "<p>x</p>" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    html: "<p>x</p>",
    width: 900,
    scale: 2,
    maxHeight: 4000,
    timeoutMs: 12000,
  });
});

test("parseRenderBody:范围外数值拒绝并人话报错", () => {
  const r = parseRenderBody({ html: "x", width: 100, scale: 9, maxHeight: 99, timeoutMs: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /width/);
  assert.match(r.error, /scale/);
  assert.match(r.error, /maxHeight/);
  assert.match(r.error, /timeoutMs/);
  assert.equal(r.status, 400);
});

test("parseRenderBody:html 超长拒绝", () => {
  const r = parseRenderBody({ html: "x".repeat(HTML_MAX_CHARS + 1) });
  assert.equal(r.ok, false);
  assert.match(r.error, /上限/);
});

test("媒体卷白名单:卷内 file:// 放行", () => {
  assert.equal(isInsideMediaRoot(ROOT, "file:///app/media/wp-content/uploads/2026/10/a.png"), true);
  assert.equal(isInsideMediaRoot(ROOT, "file:///app/media/a.png"), true);
});

test("媒体卷白名单:根本身与卷外拒绝", () => {
  assert.equal(isInsideMediaRoot(ROOT, "file:///app/media"), true); // 根本身=目录列举,禁
  assert.equal(isInsideMediaRoot(ROOT, "file:///etc/passwd"), false);
  assert.equal(isInsideMediaRoot(ROOT, "file:///app/mediax/a.png"), false); // 前缀撞车
});

test("媒体卷白名单:编码遍历与畸形输入拒绝", () => {
  assert.equal(isInsideMediaRoot(ROOT, "file:///app/media/%2e%2e/etc/passwd"), false);
  assert.equal(isInsideMediaRoot(ROOT, "file:///app/media/../../etc/passwd"), false);
  assert.equal(isInsideMediaRoot(ROOT, "file:///app/media/a%2Fb.png"), false); // fileURLToPath 抛错→拒
});

test("媒体卷白名单:非 file 协议与空根全拒", () => {
  assert.equal(isInsideMediaRoot(ROOT, "http://17aitech.com/x.png"), false);
  assert.equal(isInsideMediaRoot(ROOT, "data:image/png;base64,AAAA"), false);
  assert.equal(isInsideMediaRoot(null, "file:///app/media/a.png"), false);
  assert.equal(isInsideMediaRoot("", "file:///app/media/a.png"), false);
});

// ---------- /snapshot(M56 批A:URL 白名单校验) ----------

test("parseSnapshotBody:白名单未配置 = 端点整体禁用(403)", () => {
  const r = parseSnapshotBody({ url: "https://bigmodel.cn/glm-coding" }, []);
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("parseSnapshotBody:协议/host 校验(白名单内放行,白名单外/非 http 拒绝)", () => {
  const hosts = ["bigmodel.cn", "www.kimi.com"];
  const ok = parseSnapshotBody({ url: "https://bigmodel.cn/glm-coding" }, hosts);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, {
    url: "https://bigmodel.cn/glm-coding",
    timeoutMs: 30000,
    settleMs: 2500,
    screenshot: false,
  });
  assert.equal(parseSnapshotBody({ url: "https://evil.example.com/x" }, hosts).ok, false);
  assert.equal(parseSnapshotBody({ url: "file:///etc/passwd" }, hosts).ok, false);
  assert.equal(parseSnapshotBody({ url: "" }, hosts).ok, false);
  assert.equal(parseSnapshotBody({}, hosts).ok, false);
  // host 大小写归一后比对
  assert.equal(parseSnapshotBody({ url: "https://BIGMODEL.CN/glm-coding" }, hosts).ok, true);
});

test("parseSnapshotBody:timeout/settle 边界与缺省", () => {
  const hosts = ["bigmodel.cn"];
  const bad = parseSnapshotBody(
    { url: "https://bigmodel.cn/x", timeoutMs: 1, settleMs: 99999 },
    hosts,
  );
  assert.equal(bad.ok, false);
  const ok = parseSnapshotBody(
    { url: "https://bigmodel.cn/x", timeoutMs: 45000, settleMs: 0 },
    hosts,
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.value.timeoutMs, 45000);
  assert.equal(ok.value.settleMs, 0);
});

test("parseSnapshotBody:clickText 透传与长度边界", () => {
  const hosts = ["bigmodel.cn"];
  const ok = parseSnapshotBody({ url: "https://bigmodel.cn/x", clickText: " 连续包月 " }, hosts);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.clickText, "连续包月");
  assert.equal(parseSnapshotBody({ url: "https://bigmodel.cn/x", clickText: "" }, hosts).ok, false);
  assert.equal(
    parseSnapshotBody({ url: "https://bigmodel.cn/x", clickText: "x".repeat(41) }, hosts).ok,
    false,
  );
});

test("parseSnapshotBody:screenshot 布尔闸(缺省 false,非布尔拒绝)", () => {
  const hosts = ["bigmodel.cn"];
  const on = parseSnapshotBody({ url: "https://bigmodel.cn/x", screenshot: true }, hosts);
  assert.equal(on.ok, true);
  assert.equal(on.value.screenshot, true);
  const off = parseSnapshotBody({ url: "https://bigmodel.cn/x", screenshot: false }, hosts);
  assert.equal(off.value.screenshot, false);
  assert.equal(
    parseSnapshotBody({ url: "https://bigmodel.cn/x", screenshot: "yes" }, hosts).ok,
    false,
  );
});
