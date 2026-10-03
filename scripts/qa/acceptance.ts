/**
 * M6 切换验收脚本(standard/02 §5 验收清单前三条自动化;runbook 引用的待建项)。
 * 任一 FAIL → 退出码 1,供切换窗口/CI 判定。报告风格同 migrate-wp/verify.ts,
 * 独立实现不引其模块。用法:
 *   npm run qa:acceptance                # 基准 NEXT_PUBLIC_SITE_URL ?? http://localhost:3000
 *   npm run qa:acceptance -- --base https://17aitech.com --count 30 --seed 20261003
 * 断言组:
 *   ① sitemap:loc > 150;抽 count 篇文章页 → 200 + <article + h1 非空 + 前 3 图 200
 *   ② 资讯旧链:PG legacy_url_map(target_url LIKE '/articles%')抽 count 条 → 301 /articles
 *   ③ /feed/ → 301 /feed.xml;feed 含 <item>;robots.txt 含 Sitemap:
 *   ④ /、/articles/、/archive/、/search/?q=ai、/about/ 全 200
 *   ⑤ /admin/ 无凭证 → 3xx 跳登录
 * PG 仅只读抽样(max 2);HTTP 请求带 15s 超时,切换窗口不悬挂。
 */
import { pathToFileURL } from "node:url";
import pg from "pg";

export interface CheckResult {
  id: number;
  name: string;
  status: "PASS" | "FAIL";
  details: string;
}

export interface AcceptanceOptions {
  base: string;
  count: number;
  seed: number;
}

/** 确定性抽样(LCG;同 seed 可重放,与 verify.ts 同算法独立实现) */
export function makeSampler(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export function sample<T>(arr: T[], n: number, rand: () => number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (out.length < n && pool.length > 0)
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

function parseArgs(argv: string[]): AcceptanceOptions {
  const opts: AcceptanceOptions = {
    base: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    count: 30,
    seed: 20261003,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base" && argv[i + 1]) opts.base = argv[++i].replace(/\/$/, "");
    else if (argv[i] === "--count" && argv[i + 1]) opts.count = Number(argv[++i]) || 30;
    else if (argv[i] === "--seed" && argv[i + 1]) opts.seed = Number(argv[++i]) || 20261003;
  }
  return opts;
}

const TIMEOUT_MS = 15_000;

async function req(url: string, follow: boolean): Promise<Response> {
  return fetch(url, {
    redirect: follow ? "follow" : "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

const REDIRECTS = [301, 302, 303, 307, 308];

/**
 * 取 location 首值。Next 重定向响应会带两个相同 location 头,undici 取值时
 * 以 ", " 连接(如 "/articles, /articles");location 语义上恒为 ASCII 路径,
 * 按首个逗号截取安全。
 */
function firstLocation(res: Response): string {
  return (res.headers.get("location") ?? "").split(",")[0].trim();
}

/** sitemap 中非静态单段路径 = 文章页(与读侧 hot-pages 同口径) */
const STATIC_PATHS = new Set([
  "/",
  "/articles/",
  "/archive/",
  "/about/",
  "/search/",
  "/agreement/",
  "/privacy/",
]);

function sitemapArticleLocs(xml: string, base: string): string[] {
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  return locs.filter((loc) => {
    const path = new URL(loc).pathname;
    if (STATIC_PATHS.has(path) || path === "/feed.xml" || path === "/robots.txt") return false;
    const seg = decodeURI(path).replace(/^\/+|\/+$/g, ""); // 前导+尾斜杠都剥
    return seg.length > 0 && !seg.includes("/") && !seg.includes(".");
  });
}

function extractImgSrcs(html: string, base: string): string[] {
  const seen = new Set<string>();
  for (const m of html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) {
    if (m[1].startsWith("data:")) continue;
    seen.add(new URL(m[1], base).toString());
  }
  return [...seen];
}

export async function runAcceptance(opts: AcceptanceOptions): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const add = (name: string, ok: boolean, details: string): void => {
    checks.push({ id: checks.length + 1, name, status: ok ? "PASS" : "FAIL", details });
  };
  const rand = makeSampler(opts.seed);

  // ── ① sitemap 与文章页抽验 ──
  const smRes = await req(`${opts.base}/sitemap.xml`, true);
  if (smRes.status !== 200) {
    add("① sitemap 可达", false, `GET /sitemap.xml → ${smRes.status}`);
  } else {
    const xml = await smRes.text();
    const locs = sitemapArticleLocs(xml, opts.base);
    add(
      "① sitemap loc 数",
      xml.length > 0 && locs.length > 150,
      `文章 loc ${locs.length}(要求 >150)`,
    );
    const picked = sample(locs, opts.count, rand);
    let okPosts = 0;
    const problems: string[] = [];
    for (const loc of picked) {
      const res = await req(loc, true);
      if (res.status !== 200) {
        problems.push(`${loc} → ${res.status}`);
        continue;
      }
      const html = await res.text();
      const h1 = html
        .match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]
        ?.replace(/<[^>]+>/g, "")
        .trim();
      if (!html.includes("<article") || !h1) {
        problems.push(`${loc} 缺 <article> 或 h1 为空`);
        continue;
      }
      const imgs = extractImgSrcs(html, opts.base).slice(0, 3);
      let imgsOk = true;
      for (const img of imgs) {
        const ir = await req(img, true);
        if (ir.status !== 200) {
          imgsOk = false;
          problems.push(`${loc} 图片 ${img} → ${ir.status}`);
          break;
        }
      }
      if (imgsOk) okPosts++;
    }
    add(
      "① 文章页抽验",
      problems.length === 0,
      `${okPosts}/${picked.length} 篇 200 + <article> + h1 + 图片完整${problems.length ? `;首例:${problems[0]}` : ""}`,
    );
  }

  // ── ② 资讯旧链 301 ──
  {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    let oldPaths: string[] = [];
    try {
      const r = await pool.query<{ old_path: string }>(
        "SELECT old_path FROM legacy_url_map WHERE target_url LIKE '/articles%'",
      );
      oldPaths = sample(
        r.rows.map((x) => x.old_path),
        opts.count,
        rand,
      );
    } finally {
      await pool.end();
    }
    let okCount = 0;
    const problems: string[] = [];
    for (const p of oldPaths) {
      const res = await req(`${opts.base}${p}`, false);
      const loc = firstLocation(res);
      const toArticles =
        loc !== "" && new URL(loc, opts.base).pathname.replace(/\/$/, "") === "/articles";
      // 永久重定向即可:单段 slug 走 /[slug] 兜底 permanentRedirect(308),多段走 legacy 路由(301)
      if ((res.status === 301 || res.status === 308) && toArticles) okCount++;
      else problems.push(`${p} → ${res.status} ${loc || "(无 location)"}`);
    }
    add(
      "② 资讯旧链永久重定向 → /articles",
      oldPaths.length > 0 && problems.length === 0,
      `${okCount}/${oldPaths.length} 条 301/308${problems.length ? `;首例:${problems[0]}` : ""}`,
    );
  }

  // ── ③ feed 与 robots ──
  {
    const feedRes = await req(`${opts.base}/feed/`, false);
    const loc = firstLocation(feedRes);
    add(
      "③ /feed/ → 301 /feed.xml",
      (feedRes.status === 301 || feedRes.status === 308) &&
        new URL(loc || "x", opts.base).pathname === "/feed.xml",
      `→ ${feedRes.status} ${loc || "(无 location)"}`,
    );
    const feedXml = await req(`${opts.base}/feed.xml`, true);
    add(
      "③ feed.xml 含 <item>",
      feedXml.status === 200 && (await feedXml.text()).includes("<item>"),
      `GET /feed.xml → ${feedXml.status}`,
    );
    const robots = await req(`${opts.base}/robots.txt`, true);
    add(
      "③ robots.txt 含 Sitemap:",
      robots.status === 200 && (await robots.text()).includes("Sitemap:"),
      `GET /robots.txt → ${robots.status}`,
    );
  }

  // ── ④ 核心页面 200 ──
  {
    const pages = ["/", "/articles/", "/archive/", "/search/?q=ai", "/about/"];
    const bad: string[] = [];
    for (const p of pages) {
      const res = await req(`${opts.base}${p}`, true);
      if (res.status !== 200) bad.push(`${p} → ${res.status}`);
    }
    add(
      "④ 核心页面 200",
      bad.length === 0,
      bad.length ? bad.join("; ") : `${pages.length} 页全 200`,
    );
  }

  // ── ⑤ admin 守卫 ──
  {
    const res = await req(`${opts.base}/admin/`, false);
    const loc = firstLocation(res);
    add(
      "⑤ /admin/ 无凭证 → 跳登录",
      REDIRECTS.includes(res.status) && loc.includes("/admin/login"),
      `→ ${res.status} ${loc || "(无 location)"}`,
    );
  }

  return checks;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`# M6 切换验收 base=${opts.base} count=${opts.count} seed=${opts.seed}`);
  const checks = await runAcceptance(opts);
  for (const c of checks) console.log(`[${c.status}] #${c.id} ${c.name} — ${c.details}`);
  const fail = checks.filter((c) => c.status === "FAIL").length;
  console.log(`== 验收结果:${checks.length - fail} PASS / ${fail} FAIL ==`);
  if (fail > 0) process.exitCode = 1;
}

/* CLI 直跑执行;vitest 引入仅取纯函数/runner,不触发 main */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    console.error(`acceptance 失败:${String(err)}`);
    process.exit(1);
  });
}
