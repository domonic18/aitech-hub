/**
 * 并发槽位归还回归锚(2026-11-01 CodeReview S1):
 * 端点曾把 `release()` 只挂在渲染主体的 finally 上,body/校验失败的 `return`
 * 走不到那里 → 每来一个畸形请求就永久吃掉一个槽位,MAX_CONCURRENT=2 时
 * 两个坏请求即可让整个 sidecar 全程 429 直到重启。
 *
 * 这里起真进程(不 mock),MAX_CONCURRENT=1,连发两个**校验不通过**的请求:
 * 两个都必须拿到 400;第二个若变 429 即说明槽位没还回来。
 * 畸形请求不进浏览器,故本用例不依赖 chromium 是否装好。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let child;

after(() => {
  child?.kill("SIGKILL");
});

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** 等到端口可连(不依赖 /health:它会拉浏览器,冷启慢且与本次断言无关) */
async function waitForPort(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise((resolve) => {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => resolve(false));
    });
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`端口 ${port} 未在 ${timeoutMs}ms 内就绪`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("校验失败的请求必须归还并发槽位(不得把服务打成 429)", async () => {
  const port = await freePort();
  child = spawn(process.execPath, ["index.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), MAX_CONCURRENT: "1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += String(c)));

  await waitForPort(port);

  const post = (body) =>
    fetch(`http://127.0.0.1:${port}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

  // ① 校验不通过(缺 html)→ 400
  const first = await post("{}");
  assert.equal(first.status, 400, `首个畸形请求应为 400,实得 ${first.status}`);

  // ② 槽位必须已归还:再来一个仍是 400,绝不能是 429
  const second = await post("{}");
  assert.equal(second.status, 400, `槽位未归还(实得 ${second.status});stderr=${stderr}`);

  // ③ 非法 JSON 走的是同一收尾路径
  const third = await post("not-json");
  assert.equal(third.status, 400, `非法 JSON 应为 400,实得 ${third.status}`);
});
