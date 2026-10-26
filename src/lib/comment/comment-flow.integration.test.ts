/**
 * 评论/点赞全链路集成测试(M23 批②,standard/01-testing:*.integration.test.ts
 * 同层;`npm run test:integration`,不进 test:unit/make check/CI——依赖 dev
 * compose 的 PG/Redis)。直调路由函数覆盖:GET 仅 visible+分页+liked 随身份;
 * POST 401/成功即时 visible/父校验/屏蔽词/限流 429;点赞身份去重(u:/v: 两空间)
 * 与 404 面;批③治理:PUT/DELETE 401/400/404 面、隐藏→前台即时收敛、删根
 * 连带直接子与点赞行、listCommentsAdmin 分段/replyCount/q。前置:docker
 * compose up -d postgres redis && npx prisma migrate deploy;测试自清理数据与限流桶。
 */
import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
// pino 在模块导入时读 LOG_LEVEL,须先静音再引路由
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

const { GET: commentsGET, POST: commentsPOST } = await import("@/app/api/post-comments/route");
const { POST: postLikePOST, GET: postLikeGET } = await import("@/app/api/post-like/route");
const { POST: commentLikePOST, GET: commentLikeGET } = await import("@/app/api/comment-like/route");
const { POST: loginPOST } = await import("@/app/api/auth/login/route");
const { PUT: commentPUT, DELETE: commentDELETE } =
  await import("@/app/api/post-comments/[id]/route");
const { listCommentsAdmin } = await import("@/lib/comment/comment-admin");

const PHONE = "13900000003";
const PASSWORD = "it-m23-pass1";
const CAT_SLUG = "it-m23-cat";
const POST_SLUG = "it-m23-post";
const DRAFT_SLUG = "it-m23-draft";
const WORD = "m23禁词";

const ORIGIN_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: "http://localhost:3000",
  "x-forwarded-host": "localhost:3000",
};

interface Envelope {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

function req(url: string, method: string, cookie: string | undefined, body?: object): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      ...ORIGIN_HEADERS,
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const getComments = (postId: string, page = 1, cookie?: string): Promise<Response> =>
  commentsGET(
    req(`http://localhost:3000/api/post-comments?postId=${postId}&page=${page}`, "GET", cookie),
  );

const postComment = (body: object, cookie?: string): Promise<Response> =>
  commentsPOST(req("http://localhost:3000/api/post-comments", "POST", cookie, body));

const togglePostLike = (postId: string, cookie?: string): Promise<Response> =>
  postLikePOST(req("http://localhost:3000/api/post-like", "POST", cookie, { postId }));

const postLikeState = (postId: string, cookie?: string): Promise<Response> =>
  postLikeGET(req(`http://localhost:3000/api/post-like?postId=${postId}`, "GET", cookie));

const toggleCommentLike = (commentId: string, cookie?: string): Promise<Response> =>
  commentLikePOST(req("http://localhost:3000/api/comment-like", "POST", cookie, { commentId }));

const commentLikeState = (commentId: string, cookie?: string): Promise<Response> =>
  commentLikeGET(
    req(`http://localhost:3000/api/comment-like?commentId=${commentId}`, "GET", cookie),
  );

const putCommentStatus = (id: string, body: object, cookie?: string): Promise<Response> =>
  commentPUT(req(`http://localhost:3000/api/post-comments/${id}`, "PUT", cookie, body), {
    params: Promise.resolve({ id }),
  });

const deleteComment = (id: string, cookie?: string): Promise<Response> =>
  commentDELETE(req(`http://localhost:3000/api/post-comments/${id}`, "DELETE", cookie), {
    params: Promise.resolve({ id }),
  });

/** 从 like 响应种下的 ah_av 取游客 cookie(并登记限流桶便于清理) */
function guestCookieOf(res: Response): string {
  const m = /ah_av=[^;]+/.exec(res.headers.get("set-cookie") ?? "");
  expect(m).toBeTruthy();
  const cookie = m![0];
  redisBuckets.push(`like:idt:v:${cookie.slice("ah_av=".length)}`);
  return cookie;
}

const redisBuckets: string[] = [];
let userId = "";
let postId = "";
let draftId = "";
let adminCookie = "";
let midRootId = "";
let newestRootId = "";
let hiddenRootId = "";

beforeAll(async () => {
  const account = await prisma.userAccount.upsert({
    where: { phone: PHONE },
    update: { role: "admin", status: "active", passwordHash: await bcrypt.hash(PASSWORD, 10) },
    create: {
      phone: PHONE,
      nickname: "it-m23-user",
      role: "admin",
      status: "active",
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  userId = account.id.toString();
  const category = await prisma.category.upsert({
    where: { slug: CAT_SLUG },
    update: {},
    create: { slug: CAT_SLUG, name: "IT-M23 评论测试" },
  });
  const post = await prisma.post.upsert({
    where: { slug: POST_SLUG },
    update: { status: "published" },
    create: {
      slug: POST_SLUG,
      title: "M23 评论集成测试文",
      contentMd: "正文",
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(),
    },
  });
  postId = post.id.toString();
  const draft = await prisma.post.upsert({
    where: { slug: DRAFT_SLUG },
    update: { status: "draft" },
    create: {
      slug: DRAFT_SLUG,
      title: "M23 草稿文",
      contentMd: "草稿",
      categoryId: category.id,
      status: "draft",
    },
  });
  draftId = draft.id.toString();
  adminCookie = await (async (): Promise<string> => {
    const res = await loginPOST(
      req("http://localhost:3000/api/auth/login", "POST", undefined, {
        account: PHONE,
        password: PASSWORD,
      }),
    );
    expect(res.status).toBe(200);
    return (res.headers.get("set-cookie") ?? "").split(";")[0];
  })();
  // 清场历史残留(测试数据锚定在固定 slug/postId 上,可重入)
  await prisma.postComment.deleteMany({ where: { postId: post.id } });
  await prisma.postLike.deleteMany({ where: { postId: post.id } });
  // 种子:12 根(visible,分钟级递减保 desc 序)+1 楼中楼+1 隐藏回复+1 隐藏根
  const roots = await prisma.$transaction(
    Array.from({ length: 12 }, (_, i) =>
      prisma.postComment.create({
        data: {
          postId: post.id,
          userId: account.id,
          authorName: "it-m23-user",
          content: `根评论 ${i}`,
          status: "visible",
          parentId: null,
          createdAt: new Date(Date.now() - (i + 1) * 60_000),
        },
      }),
    ),
  );
  newestRootId = roots[0]!.id.toString();
  midRootId = roots[5]!.id.toString();
  hiddenRootId = (
    await prisma.postComment.create({
      data: {
        postId: post.id,
        authorName: "旧访客",
        content: "隐藏根",
        status: "hidden",
        parentId: null,
      },
    })
  ).id.toString();
  await prisma.postComment.create({
    data: {
      postId: post.id,
      authorName: "旧访客",
      content: "楼中楼回复",
      status: "visible",
      parentId: roots[5]!.id,
    },
  });
  await prisma.postComment.create({
    data: {
      postId: post.id,
      authorName: "旧访客",
      content: "隐藏回复",
      status: "hidden",
      parentId: roots[5]!.id,
    },
  });
  redisBuckets.push(`comment:u:${userId}`, `like:idt:u:${userId}`);
  await redis.del(...redisBuckets);
});

afterAll(async () => {
  await prisma.postComment.deleteMany({
    where: { post: { slug: { in: [POST_SLUG, DRAFT_SLUG] } } },
  });
  await prisma.postLike.deleteMany({ where: { post: { slug: { in: [POST_SLUG, DRAFT_SLUG] } } } });
  await prisma.post.deleteMany({ where: { slug: { in: [POST_SLUG, DRAFT_SLUG] } } });
  await prisma.category.deleteMany({ where: { slug: CAT_SLUG } });
  await prisma.blocklist.deleteMany({ where: { word: WORD } });
  await prisma.userAccount.deleteMany({ where: { phone: PHONE } });
  await redis.del(...redisBuckets);
  await prisma.$disconnect();
});

describe("评论 GET(dev compose 真实 PG/Redis)", () => {
  it("仅 visible:根 desc 分页(10/页)+ 楼中楼随根 + hidden 不出境", async () => {
    const res = await getComments(postId);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        items: Array<Record<string, unknown>>;
        total: number;
        hasMore: boolean;
        page: number;
      };
    };
    expect(data.total).toBe(12);
    expect(data.items).toHaveLength(10);
    expect(data.hasMore).toBe(true);
    expect(data.items[0]).toMatchObject({ content: "根评论 0", parentId: null });
    const root5 = data.items.find((c) => c["content"] === "根评论 5") as {
      replies: Array<Record<string, unknown>>;
    };
    expect(root5.replies).toHaveLength(1);
    expect(root5.replies[0]).toMatchObject({ content: "楼中楼回复" });

    const p2 = await getComments(postId, 2);
    const d2 = (await p2.json()) as {
      data: { items: Array<Record<string, unknown>>; hasMore: boolean };
    };
    expect(d2.data.items).toHaveLength(2);
    expect(d2.data.hasMore).toBe(false);

    expect((await getComments(draftId)).status).toBe(404); // 草稿文评论区 404
  });

  it("liked 随身份:游客 cookie 赞过的评论在列表带 liked=true,匿名恒 false", async () => {
    const likeRes = await toggleCommentLike(newestRootId);
    expect((await likeRes.json()) as Envelope).toMatchObject({ code: 0 });
    const cookie = guestCookieOf(likeRes);

    const anon = (await (await getComments(postId)).json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    const anonRoot0 = anon.data.items.find((c) => c["id"] === newestRootId) as Record<
      string,
      unknown
    >;
    expect(anonRoot0["liked"]).toBe(false);

    const withId = (await (await getComments(postId, 1, cookie)).json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    const likedRoot0 = withId.data.items.find((c) => c["id"] === newestRootId) as Record<
      string,
      unknown
    >;
    expect(likedRoot0["liked"]).toBe(true);
    expect(likedRoot0["likeCount"]).toBe(1);
  });
});

describe("评论 POST(登录写,先发后审)", () => {
  it("未登录 401;登录成功即时 visible(authorName 快照昵称)", async () => {
    expect((await postComment({ postId, content: "游客不许评论" })).status).toBe(401);

    const res = await postComment({ postId, content: "集成测试新评论" }, adminCookie);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { item: Record<string, unknown> } };
    expect(data.item).toMatchObject({
      status: "visible",
      authorName: "it-m23-user",
      parentId: null,
      likeCount: 0,
      liked: false,
    });
    const list = (await (await getComments(postId)).json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    expect(list.data.items[0]!["content"]).toBe("集成测试新评论"); // 即时可见,最新在前
  });

  it("父校验:可回复根;回复楼中楼(三级)/隐藏父/不存在父一律 400", async () => {
    const root = (await (await getComments(postId)).json()) as {
      data: { items: Array<{ id: string; replies: Array<{ id: string }> }> };
    };
    const rootId = root.data.items[0]!.id;
    const ok = await postComment(
      { postId, content: "楼中楼新回复", parentId: rootId },
      adminCookie,
    );
    const okBody = (await ok.json()) as { data: { item: { id: string; parentId: string | null } } };
    expect(okBody.data.item.parentId).toBe(rootId);

    const replyId = okBody.data.item.id;
    expect(
      (await postComment({ postId, content: "三级", parentId: replyId }, adminCookie)).status,
    ).toBe(400);
    expect(
      (await postComment({ postId, content: "回隐藏", parentId: hiddenRootId }, adminCookie))
        .status,
    ).toBe(400);
    expect(
      (await postComment({ postId, content: "回不存在", parentId: "999999" }, adminCookie)).status,
    ).toBe(400);
  });

  it("屏蔽词命中 400 拒提交(先发后审的自动闸)", async () => {
    await prisma.blocklist.create({ data: { word: WORD, scope: "comment", enabled: true } });
    try {
      const res = await postComment({ postId, content: `含 ${WORD} 的评论` }, adminCookie);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).message).toBe("评论包含不允许的内容");
    } finally {
      await prisma.blocklist.deleteMany({ where: { word: WORD } });
    }
  });

  it("用户桶顶满 → 429;成功计数语义(recordHit 在写入后)", async () => {
    await redis.set(`comment:u:${userId}`, "10");
    try {
      expect((await postComment({ postId, content: "超限评论" }, adminCookie)).status).toBe(429);
    } finally {
      await redis.del(`comment:u:${userId}`);
    }
  });
});

describe("点赞(dev compose 真实 PG/Redis)", () => {
  it("游客 toggle:种 ah_av 去重,再点取消;不同游客独立计数", async () => {
    const first = await togglePostLike(postId);
    expect(((await first.json()) as { data: Record<string, unknown> }).data).toMatchObject({
      liked: true,
      count: 1,
    });
    const guest = guestCookieOf(first);

    expect(
      ((await (await togglePostLike(postId, guest)).json()) as { data: Record<string, unknown> })
        .data,
    ).toMatchObject({ liked: false, count: 0 });
    expect(
      ((await (await postLikeState(postId, guest)).json()) as { data: Record<string, unknown> })
        .data,
    ).toMatchObject({ liked: false, count: 0 });

    const other = await togglePostLike(postId); // 无 cookie = 新游客身份
    expect(((await other.json()) as { data: Record<string, unknown> }).data).toMatchObject({
      liked: true,
      count: 1,
    });
    redisBuckets.push(`like:idt:v:${guestCookieOf(other).slice("ah_av=".length)}`);
  });

  it("登录身份落 u: 空间(与游客 v: 互不合并),可再取消", async () => {
    expect(
      (
        (await (await togglePostLike(postId, adminCookie)).json()) as {
          data: Record<string, unknown>;
        }
      ).data,
    ).toMatchObject({ liked: true, count: 2 });
    const row = await prisma.postLike.findFirst({
      where: { postId: BigInt(postId), identityKey: { startsWith: "u:" } },
    });
    expect(row?.identityKey).toBe(`u:${userId}`);
    expect(
      (
        (await (await togglePostLike(postId, adminCookie)).json()) as {
          data: Record<string, unknown>;
        }
      ).data,
    ).toMatchObject({ liked: false, count: 1 });
  });

  it("隐藏评论点赞/查态一律 404(评论区随治理即时收敛)", async () => {
    expect((await toggleCommentLike(hiddenRootId)).status).toBe(404);
    expect((await commentLikeState(hiddenRootId)).status).toBe(404);
  });
});

describe("评论治理 admin API(M23 批③,仅会话 PAT 拒)", () => {
  it("未登录 401;非数字 id 400;非法 status 400;不存在 404", async () => {
    expect((await putCommentStatus(newestRootId, { status: "hidden" })).status).toBe(401);
    expect((await deleteComment(newestRootId)).status).toBe(401);

    expect((await putCommentStatus("abc", { status: "hidden" }, adminCookie)).status).toBe(400);
    expect((await deleteComment("12x", adminCookie)).status).toBe(400);
    expect((await putCommentStatus(newestRootId, { status: "pending" }, adminCookie)).status).toBe(
      400,
    );
    expect((await putCommentStatus("999999", { status: "hidden" }, adminCookie)).status).toBe(404);
    expect((await deleteComment("999999", adminCookie)).status).toBe(404);
  });

  it("admin 隐藏→前台即时消失;恢复→再现(client fetch 零 revalidate 收敛)", async () => {
    const put = await putCommentStatus(midRootId, { status: "hidden" }, adminCookie);
    expect(put.status).toBe(200);
    expect(((await put.json()) as { data: { item: { status: string } } }).data.item.status).toBe(
      "hidden",
    );
    let list = (await (await getComments(postId)).json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    expect(list.data.items.some((c) => c["id"] === midRootId)).toBe(false);

    const restore = await putCommentStatus(midRootId, { status: "visible" }, adminCookie);
    expect(restore.status).toBe(200);
    list = (await (await getComments(postId)).json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    expect(list.data.items.some((c) => c["id"] === midRootId)).toBe(true);
  });

  it("DELETE 删根连带直接子与点赞行(物理不可逆,deleted=2)", async () => {
    // 自建根+回复+两条点赞,自包含不踩前序用例数据
    const root = await prisma.postComment.create({
      data: { postId: BigInt(postId), authorName: "待删根", content: "待删根", status: "visible" },
    });
    const reply = await prisma.postComment.create({
      data: {
        postId: BigInt(postId),
        authorName: "待删回复",
        content: "待删回复",
        status: "visible",
        parentId: root.id,
      },
    });
    for (let i = 0; i < 2; i += 1) {
      // 各匿名请求=独立游客身份,落两条 like 行验证连带
      const likeRes = await toggleCommentLike(root.id.toString());
      expect(((await likeRes.json()) as Envelope).code).toBe(0);
      guestCookieOf(likeRes);
    }
    expect(await prisma.postCommentLike.count({ where: { commentId: root.id } })).toBe(2);

    const res = await deleteComment(root.id.toString(), adminCookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { deleted: number } }).data.deleted).toBe(2);
    expect(await prisma.postComment.count({ where: { id: { in: [root.id, reply.id] } } })).toBe(0);
    expect(await prisma.postCommentLike.count({ where: { commentId: root.id } })).toBe(0);
  });

  it("listCommentsAdmin:分段计数自洽 + replyCount 直接子计数 + q 命中", async () => {
    const all = await listCommentsAdmin({ page: 1, segment: "all" });
    expect(all.counts.all).toBe(all.counts.visible + all.counts.hidden);

    const hidden = await listCommentsAdmin({ page: 1, segment: "hidden" });
    expect(hidden.items.every((r) => r.status === "hidden")).toBe(true);

    const mid = all.items.find((r) => r.id === midRootId);
    expect(mid?.replyCount).toBe(2); // 楼中楼回复(visible)+ 隐藏回复

    const hit = await listCommentsAdmin({ page: 1, segment: "all", q: "集成测试新评论" });
    expect(hit.items).toHaveLength(1);
    expect(hit.items[0]!.postSlug).toBe(POST_SLUG);
  });
});
