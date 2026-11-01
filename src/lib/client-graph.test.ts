/**
 * 客户端 bundle 边界回归锚(2026-11-01 生产事故:站点设置页 + /pricing/ 白屏)。
 *
 * 事故链:`db.ts` 改读 `env.NODE_ENV` 后,任何"客户端组件 → 某个 config/读数模块
 * → lib/db → lib/env"的值导入闭包都会把 env 的 zod `safeParse(process.env)` 打进
 * client chunk;浏览器里 DATABASE_URL/AUTH_SECRET 缺失 → 模块初始化抛
 * 「环境变量校验失败」→ 整页 Application error。构建不报错、类型检查也不报错,
 * 只有真机访问才炸——所以在这里用静态闭包扫描兜住。
 *
 * 判据:从每个 `"use client"` 模块出发,顺着**值导入**(`import type` 会被擦除,
 * 不计)走完整个闭包,不得触达下述服务端模块。修法始终是"把纯常量/纯函数拆到
 * 零依赖模块",不是放宽本用例。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
/** 触达即把服务端 env 校验 / PrismaClient 拖进浏览器的模块(可继续追加) */
const SERVER_ONLY = ["src/lib/env.ts", "src/lib/db.ts"];

function collectSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collectSources(path, out);
    else if (/\.(ts|tsx)$/.test(path) && !/\.test\.(ts|tsx)$/.test(path)) out.push(path);
  }
  return out;
}

const files = collectSources(SRC);
const sourceOf = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

/** 值导入的模块说明符(排除 `import type` / `export type`) */
function valueSpecifiers(file: string): string[] {
  const source = sourceOf.get(file) ?? "";
  const specs: string[] = [];
  const fromRe = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;\n]*?from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source))) if (!m[1]) specs.push(m[2]!);
  const bareRe = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  while ((m = bareRe.exec(source))) specs.push(m[1]!);
  return specs;
}

/** 只解析仓内路径(`@/…` 与相对路径),第三方包返回 null */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    try {
      if (statSync(base + ext).isFile()) return base + ext;
    } catch {
      /* 不是候选扩展名,继续试下一个 */
    }
  }
  return null;
}

/** 从给定入口出发,返回所有触达 SERVER_ONLY 的链路(空数组 = 干净) */
function serverOnlyChains(entry: string): string[] {
  const chains: string[] = [];
  const seen = new Set([entry]);
  const queue: Array<{ file: string; path: string[] }> = [{ file: entry, path: [entry] }];
  while (queue.length > 0) {
    const { file, path } = queue.pop()!;
    for (const spec of valueSpecifiers(file)) {
      const target = resolveSpecifier(spec, file);
      if (target === null || seen.has(target)) continue;
      seen.add(target);
      const rel = path.concat(target).map((p) => p.slice(ROOT.length + 1));
      if (SERVER_ONLY.includes(rel.at(-1)!)) chains.push(rel.join(" → "));
      else queue.push({ file: target, path: path.concat(target) });
    }
  }
  return chains;
}

describe("客户端值导入闭包", () => {
  it("不得触达 lib/db、lib/env(会把 env 校验打浏览器、整页白屏)", () => {
    const entries = files.filter((f) => /^\s*["']use client["']/m.test(sourceOf.get(f) ?? ""));
    expect(entries.length).toBeGreaterThan(100); // 扫描本身失效时别静默放行
    const chains = entries.flatMap(serverOnlyChains);
    expect(chains).toEqual([]);
  });
});
