/**
 * 文章管理集成测试(standard/01-testing:*.integration.test.ts 同层;`npm run test:integration`,
 * 不进 test:unit/make check/CI——依赖 dev compose 的 PG/Redis)。
 * 覆盖 M5-a 主线:新建草稿(slug 派生/标签去重)→ slug 冲突 → 草稿前台不可见 →
 * 发布(前台可见 + revalidate 编排)→ 下架(不可见但保留发布时间)→ 更新 →
 * 旧文保真只读 → 软删 → 守卫(Origin/未登录)。
 * 前置:docker compose up -d postgres redis && npx prisma migrate deploy;测试自清理数据。
 */
import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

loadEnvConfig(process.cwd());
// pino 在模块导入时读 LOG_LEVEL,须先静音再引路由
process.env.LOG_LEVEL = "silent";

const { revalidateMock } = vi.hoisted(() => ({ revalidateMock: vi.fn() }));
// revalidatePath 在 Next 请求上下文外会抛:这里只验证 service 是否在事务提交后编排了它
vi.mock("@/lib/content/revalidate", () => ({ revalidatePostPaths: revalidateMock }));

import { prisma } from "@/lib/db";
import { type ApiEnvelope } from "@/lib/http/response";

const { POST: loginPOST } = await import("@/app/api/auth/login/route");
const { POST: createPOST } = await import("@/app/api/posts/route");
const { PUT: postPUT, DELETE: postDELETE } = await import("@/app/api/posts/[id]/route");
const { POST: publishPOST } = await import("@/app/api/posts/[id]/publish/route");
const { POST: unpublishPOST } = await import("@/app/api/posts/[id]/unpublish/route");
const { getPostForAdmin, listPostsAdmin } = await import("@/lib/content/posts-admin");
const { getPostBySlug } = await import("@/lib/content/posts");

const PHONE = "13900000003";
const PASSWORD = "it-admin-pass1";
const CAT_SLUG = "it-m5a-cat";
const LEGACY_SLUG = "it-post-m5a-legacy";

const ORIGIN_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: "http://localhost:3000",
  "x-forwarded-host": "localhost:3000",
};

function req(
  url: string,
  method: string,
  cookie: string,
  body?: unknown,
  origin = "http://localhost:3000",
): never {
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { ...ORIGIN_HEADERS, origin, cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as never;
}

async function envelope(res: Response): Promise<ApiEnvelope<unknown>> {
  return (await res.json()) as ApiEnvelope<unknown>;
}

let cookie = "";
let derivedSlug = ""; // 首用例由中文标题派生(用例间串行,后续步骤复用)

beforeAll(async () => {
  await prisma.userAccount.upsert({
    where: { phone: PHONE },
    update: { role: "admin", status: "active", passwordHash: await bcrypt.hash(PASSWORD, 10) },
    create: {
      phone: PHONE,
      nickname: "it-m5a-admin",
      role: "admin",
      status: "active",
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  await prisma.category.upsert({
    where: { slug: CAT_SLUG },
    update: { sortOrder: 999 },
    create: { slug: CAT_SLUG, name: "M5a 测试分类", sortOrder: 999 },
  });
  await prisma.post.deleteMany({ where: { title: { contains: "M5a 集成测试" } } });
  await prisma.post.deleteMany({ where: { slug: LEGACY_SLUG } });

  const login = await loginPOST(
    req("/api/auth/login", "POST", "", { phone: PHONE, password: PASSWORD }),
  );
  expect(login.status).toBe(200);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  expect(cookie).toContain("ah_at=");
});

afterAll(async () => {
  await prisma.post.deleteMany({ where: { title: { contains: "M5a 集成测试" } } });
  await prisma.post.deleteMany({ where: { slug: LEGACY_SLUG } });
  await prisma.tag.deleteMany({ where: { slug: { in: ["it-m5a-tag-one", "it-m5a-tag-two"] } } });
  await prisma.category.deleteMany({ where: { slug: CAT_SLUG } });
  await prisma.userAccount.deleteMany({ where: { phone: PHONE } });
  await prisma.$disconnect();
});

describe("文章管理写侧(dev compose 真实 PG/Redis)", () => {
  it("新建草稿:slug 缺省由标题派生、标签按名去重 upsert", async () => {
    const res = await createPOST(
      req("/api/posts", "POST", cookie, {
        title: "M5a 集成测试文章",
        categorySlug: CAT_SLUG,
        contentMd: "# 正文\n\nM5a 内容。",
        tags: ["it-m5a-tag-one", "it-m5a-tag-one", " it-m5a-tag-two "],
      }),
    );
    expect(res.status).toBe(200);
    const { code, data } = await envelope(res);
    expect(code).toBe(0);
    const created = data as { id: string; slug: string };
    // 标题派生 slug:字面量保留大写,中文段 percent-encoded 小写(normalizeSlug)
    expect(created.slug).toMatch(/^M5a%20/);
    derivedSlug = created.slug;
    const row = await prisma.post.findUnique({ where: { slug: derivedSlug } });
    expect(row?.status).toBe("draft");
    expect(row?.publishedAt).toBeNull();
    const tagNames = await prisma.postTag.findMany({
      where: { postId: row!.id },
      include: { tag: true },
    });
    expect(tagNames.map((t) => t.tag.slug).sort()).toEqual(["it-m5a-tag-one", "it-m5a-tag-two"]);
  });

  it("重复 slug → 409;非法体 → 400;分类不存在 → 400", async () => {
    const dup = await createPOST(
      req("/api/posts", "POST", cookie, {
        title: "重复",
        contentMd: "x",
        categorySlug: CAT_SLUG,
        slug: derivedSlug, // 显式传已存在的 slug(含编码形态,经 normalizeSlug 归一)
      }),
    );
    expect(dup.status).toBe(409);

    const bad = await createPOST(
      req("/api/posts", "POST", cookie, { title: "", contentMd: "x", categorySlug: CAT_SLUG }),
    );
    expect(bad.status).toBe(400);

    const noCat = await createPOST(
      req("/api/posts", "POST", cookie, {
        title: "无分类",
        contentMd: "x",
        categorySlug: "no-such-cat",
      }),
    );
    expect(noCat.status).toBe(400);
  });

  it("草稿对前台读侧不可见;管理列表可见且分段计数正确", async () => {
    expect(await getPostBySlug(derivedSlug)).toBeNull();
    const draftList = await listPostsAdmin({ page: 1, segment: "draft" });
    expect(draftList.items.some((p) => p.wpPostId === null && p.title.includes("M5a"))).toBe(true);
  });

  it("守卫:跨 Origin 403;未登录 401", async () => {
    const cross = await createPOST(
      req(
        "/api/posts",
        "POST",
        cookie,
        { title: "x", contentMd: "x", categorySlug: CAT_SLUG },
        "https://evil.example.com",
      ),
    );
    expect(cross.status).toBe(403);
    const anon = await createPOST(
      req("/api/posts", "POST", "", { title: "x", contentMd: "x", categorySlug: CAT_SLUG }),
    );
    expect(anon.status).toBe(401);
  });

  it("发布 → 前台可见 + revalidate 编排;下架 → 不可见但保留发布时间", async () => {
    const post = await prisma.post.findUniqueOrThrow({ where: { slug: derivedSlug } });
    const pub = await publishPOST(req(`/api/posts/${post.id}/publish`, "POST", cookie), {
      params: Promise.resolve({ id: post.id.toString() }),
    });
    expect(pub.status).toBe(200);
    expect(revalidateMock).toHaveBeenCalledWith(derivedSlug);
    const visible = await getPostBySlug(derivedSlug);
    expect(visible?.title).toContain("M5a");
    expect(visible?.publishedAt).not.toBeNull();

    const unpub = await unpublishPOST(req(`/api/posts/${post.id}/unpublish`, "POST", cookie), {
      params: Promise.resolve({ id: post.id.toString() }),
    });
    expect(unpub.status).toBe(200);
    expect(await getPostBySlug(derivedSlug)).toBeNull();
    const after = await prisma.post.findUniqueOrThrow({ where: { slug: derivedSlug } });
    expect(after.status).toBe("draft");
    expect(after.publishedAt).not.toBeNull(); // 下架保留发布时间(展示态「已下架」)
  });

  it("更新草稿:字段落库且不触发 revalidate;管理取稿含分类/标签", async () => {
    const post = await prisma.post.findUniqueOrThrow({ where: { slug: derivedSlug } });
    const calls = revalidateMock.mock.calls.length;
    const res = await postPUT(
      req(`/api/posts/${post.id}`, "PUT", cookie, {
        title: "M5a 集成测试文章(改)",
        categorySlug: CAT_SLUG,
        contentMd: "# 正文 v2",
        tags: ["it-m5a-tag-one"],
        excerpt: "摘要",
        coverPath: "/wp-content/uploads/m5a.png",
        seoTitle: "SEO 标题",
        seoDescription: "SEO 描述",
      }),
      { params: Promise.resolve({ id: post.id.toString() }) },
    );
    expect(res.status).toBe(200);
    expect(revalidateMock.mock.calls.length).toBe(calls); // 草稿更新不 revalidate
    const admin = await getPostForAdmin(post.id);
    expect(admin?.title).toBe("M5a 集成测试文章(改)");
    expect(admin?.tags.map((t) => t.tag.slug)).toEqual(["it-m5a-tag-one"]);
    expect(await prisma.postTag.count({ where: { postId: post.id } })).toBe(1);
  });

  it("旧文保真:纯 HTML 正文 PUT → 409 legacy_readonly", async () => {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: CAT_SLUG } });
    await prisma.post.create({
      data: {
        slug: LEGACY_SLUG,
        title: "旧文保真样例",
        contentHtml: "<p>旧文 HTML</p>",
        categoryId: category.id,
        status: "published",
        publishedAt: new Date(),
        wpPostId: BigInt(987654321),
      },
    });
    const legacy = await prisma.post.findUniqueOrThrow({ where: { slug: LEGACY_SLUG } });
    const res = await postPUT(
      req(`/api/posts/${legacy.id}`, "PUT", cookie, {
        title: "试图改旧文",
        categorySlug: CAT_SLUG,
        contentMd: "# 新正文",
      }),
      { params: Promise.resolve({ id: legacy.id.toString() }) },
    );
    expect(res.status).toBe(409);
    const { message } = await envelope(res);
    expect(message).toContain("旧文保真");
    // 已发布旧文不受影响
    expect(await getPostBySlug(LEGACY_SLUG)).not.toBeNull();
  });

  it("软删:状态置 deleted,前台/管理双不可见", async () => {
    const post = await prisma.post.findUniqueOrThrow({ where: { slug: derivedSlug } });
    const res = await postDELETE(req(`/api/posts/${post.id}`, "DELETE", cookie), {
      params: Promise.resolve({ id: post.id.toString() }),
    });
    expect(res.status).toBe(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { slug: derivedSlug } })).status).toBe(
      "deleted",
    );
    expect(await getPostBySlug(derivedSlug)).toBeNull();
    expect(await getPostForAdmin(post.id)).toBeNull();
    const list = await listPostsAdmin({ page: 1, segment: "all" });
    expect(list.items.some((p) => p.slug === derivedSlug)).toBe(false);
  });

  it("非法路径 id → 400;不存在 id → 404", async () => {
    expect(
      (
        await publishPOST(req("/api/posts/abc/publish", "POST", cookie), {
          params: Promise.resolve({ id: "abc" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await publishPOST(req("/api/posts/99999999/publish", "POST", cookie), {
          params: Promise.resolve({ id: "99999999" }),
        })
      ).status,
    ).toBe(404);
  });
});
