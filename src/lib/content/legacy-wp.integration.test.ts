/**
 * /?p=<wpId> 旧链承接集成测试(standard/01-testing:依赖 dev compose 的 PG/Redis,
 * `npm run test:integration`,不进 make check/CI)。覆盖:已发布 → 301 文章页
 * (Location = postPath(id,slug));草稿 → 410;未命中 wpId → 410;非法段形态 → 404。
 * 前置:docker compose up -d postgres redis && npx prisma migrate deploy;测试自清理。
 */
import { loadEnvConfig } from "@next/env";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { postPath } from "@/lib/content/post-path";
import { absoluteUrl } from "@/lib/seo/site";

const { GET } = await import("@/app/(site)/legacy/[...path]/route");

const CAT_SLUG = "it-legacy-wp-cat";
const WP_PUB = BigInt(98765432101);
const WP_DRAFT = BigInt(98765432102);
const WP_MISS = BigInt(98765432103);

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

beforeAll(async () => {
  await prisma.post.deleteMany({ where: { wpPostId: { in: [WP_PUB, WP_DRAFT] } } });
  await prisma.category.deleteMany({ where: { slug: CAT_SLUG } });
  await redis.del(`legacy:wp:${WP_PUB}`, `legacy:wp:${WP_DRAFT}`, `legacy:wp:${WP_MISS}`);
  const cat = await prisma.category.create({
    data: { name: "IT 旧链承接", slug: CAT_SLUG, description: "it" },
  });
  await prisma.post.createMany({
    data: [
      {
        title: "IT 承接·已发布",
        slug: "it-legacy-wp-pub",
        contentMd: "x",
        categoryId: cat.id,
        status: "published",
        publishedAt: new Date(),
        wpPostId: WP_PUB,
      },
      {
        title: "IT 承接·草稿",
        slug: "it-legacy-wp-draft",
        contentMd: "x",
        categoryId: cat.id,
        status: "draft",
        wpPostId: WP_DRAFT,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.post.deleteMany({ where: { wpPostId: { in: [WP_PUB, WP_DRAFT] } } });
  await prisma.category.deleteMany({ where: { slug: CAT_SLUG } });
  await redis.del(`legacy:wp:${WP_PUB}`, `legacy:wp:${WP_DRAFT}`, `legacy:wp:${WP_MISS}`);
});

describe("GET /legacy/wp-p/<id>(/?p= 承接,middleware rewrite 入口)", () => {
  it("已发布文章 → 301 canonical 文章路径", async () => {
    const res = await GET(req("/legacy/wp-p/98765432101/"), {
      params: Promise.resolve({ path: ["wp-p", "98765432101"] }),
    });
    expect(res.status).toBe(301);
    const row = await prisma.post.findUniqueOrThrow({ where: { wpPostId: WP_PUB } });
    expect(res.headers.get("location")).toBe(absoluteUrl(postPath(row.id, "it-legacy-wp-pub")));
  });

  it("草稿 → 410(不暴露未发布内容)", async () => {
    const res = await GET(req("/legacy/wp-p/98765432102/"), {
      params: Promise.resolve({ path: ["wp-p", "98765432102"] }),
    });
    expect(res.status).toBe(410);
  });

  it("未命中 wpId(弃用资讯/已删) → 410", async () => {
    const res = await GET(req("/legacy/wp-p/98765432103/"), {
      params: Promise.resolve({ path: ["wp-p", "98765432103"] }),
    });
    expect(res.status).toBe(410);
  });

  it("非法段形态 → 404", async () => {
    const bad = await GET(req("/legacy/wp-p/abc/"), {
      params: Promise.resolve({ path: ["wp-p", "abc"] }),
    });
    expect(bad.status).toBe(404);
    const short = await GET(req("/legacy/wp-p/"), {
      params: Promise.resolve({ path: ["wp-p"] }),
    });
    expect(short.status).toBe(404);
  });

  it("命中走缓存后行为一致(负缓存/正缓存同口径)", async () => {
    // 上一轮已写正缓存(WP_PUB)与负缓存(WP_MISS),再打一遍验证缓存路径
    const hit = await GET(req(`/legacy/wp-p/${WP_PUB}/`), {
      params: Promise.resolve({ path: ["wp-p", String(WP_PUB)] }),
    });
    expect(hit.status).toBe(301);
    const miss = await GET(req(`/legacy/wp-p/${WP_MISS}/`), {
      params: Promise.resolve({ path: ["wp-p", String(WP_MISS)] }),
    });
    expect(miss.status).toBe(410);
  });
});
