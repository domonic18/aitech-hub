/**
 * card-renderer 纯函数单测(node:test,零依赖,CI 直跑):
 * /render 入参校验边界 + file:// 媒体卷白名单(SSRF 硬闸的放行判定)。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { HTML_MAX_CHARS, isInsideMediaRoot, parseRenderBody } from "../validate.js";

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
