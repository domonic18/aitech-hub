import { describe, expect, it } from "vitest";

import { buildLegacyMap, extractUploadPaths, transformPosts } from "./transform-posts";
import { transformUsers } from "./transform-users";
import type {
  WpPostMetaRow,
  WpPostRow,
  WpRelRow,
  WpTermRow,
  WpUserMetaRow,
  WpUserRow,
  WpYoastRow,
} from "./types";

const post = (over: Partial<WpPostRow>): WpPostRow => ({
  ID: 1,
  post_author: 1,
  post_date_gmt: "2024-04-17 14:49:05",
  post_name: "%e6%b5%8b%e8%af%95%e6%96%87%e7%ab%a0",
  post_title: "测试文章",
  post_excerpt: "",
  post_content: "<p>正文</p>",
  post_type: "post",
  post_parent: 0,
  ...over,
});

const term = (term_id: number, slug: string, taxonomy: string): WpTermRow => ({
  term_id,
  slug,
  name: `t${term_id}`,
  taxonomy,
});

describe("transformPosts:范围与字段映射(03 §3)", () => {
  const input = () => ({
    posts: [
      post({ ID: 101, post_type: "post" }), // blog → 范围内
      post({ ID: 102, post_name: "news-post", post_type: "post" }), // news → 排除
      post({ ID: 103, post_type: "page" }), // 页面 → 排除
      post({ ID: 110, post_type: "attachment", post_content: "" }),
    ],
    postMeta: [
      { post_id: 110, meta_key: "_wp_attached_file", meta_value: "2024/04/封面图.png" },
      { post_id: 101, meta_key: "_thumbnail_id", meta_value: "110" },
    ] satisfies WpPostMetaRow[],
    terms: [term(28, "blog", "category"), term(27, "news", "category"), term(5, "mcp", "post_tag")],
    rels: [
      { object_id: 101, term_id: 28, taxonomy: "category" },
      { object_id: 101, term_id: 5, taxonomy: "post_tag" },
      { object_id: 102, term_id: 27, taxonomy: "category" },
    ] satisfies WpRelRow[],
    yoast: [{ object_id: 101, title: "SEO 标题", description: "SEO 描述" }] satisfies WpYoastRow[],
    viewsTotal: [{ id: 101, count: 237203 }],
  });

  it("只迁 blog/report;slug 归一;views/seo/publishedAt 就位", () => {
    const out = transformPosts(input());
    expect(out.posts).toHaveLength(1);
    const p = out.posts[0];
    expect(p.wpPostId).toBe(101);
    expect(p.slug).toBe("%e6%b5%8b%e8%af%95%e6%96%87%e7%ab%a0");
    expect(p.categorySlug).toBe("blog");
    expect(p.viewsCount).toBe(237203);
    expect(p.seoTitle).toBe("SEO 标题");
    expect(p.publishedAt).toBe("2024-04-17T14:49:05.000Z");
    expect(p.tagSlugs).toEqual(["mcp"]);
    expect(p.coverPath).toBe("/wp-content/uploads/2024/04/%e5%b0%81%e9%9d%a2%e5%9b%be.png");
    expect(out.scopedWpIds.has(102)).toBe(false);
  });

  it("封面进媒体闭包;附件 path 归一为 URL 编码形态", () => {
    const out = transformPosts(input());
    const paths = out.media.map((m) => m.path);
    expect(paths).toContain("/wp-content/uploads/2024/04/%e5%b0%81%e9%9d%a2%e5%9b%be.png");
    expect(out.mediaRefs).toContainEqual({
      postWpId: 101,
      mediaPath: "/wp-content/uploads/2024/04/%e5%b0%81%e9%9d%a2%e5%9b%be.png",
    });
  });

  it("正文引用的 uploads 图全部入闭包;同篇同 URL 去重为一条引用", () => {
    const input2 = input();
    input2.posts[0].post_content =
      '<p><img src="http://17aitech.com/wp-content/uploads/2024/04/a.png" alt="">' +
      '<img src="/wp-content/uploads/2024/04/a.png" alt=""></p>';
    const out = transformPosts(input2);
    const aRefs = out.mediaRefs.filter((r) => r.mediaPath.endsWith("/a.png"));
    expect(aRefs).toHaveLength(1);
    expect(out.media.filter((m) => m.path.endsWith("/a.png"))).toHaveLength(1);
  });

  it("base64 图:经回调落盘、URL 改写、同一次运行内跨篇按 sha1 去重", () => {
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const written: string[] = [];
    const onBase64 = (name: string): void => {
      written.push(name);
    };
    const input2 = input();
    input2.posts[0].post_content = `<p><img src="data:image/png;base64,${b64}" alt=""></p>`;
    // 第二篇引用同一张图(同一运行)
    input2.posts.push(
      post({
        ID: 105,
        post_type: "post",
        post_content: `<p><img src="data:image/png;base64,${b64}" alt=""></p>`,
      }),
    );
    input2.rels.push({ object_id: 105, term_id: 28, taxonomy: "category" });
    const out = transformPosts({ ...input2, onBase64 });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/\.png$/);
    expect(out.posts.filter((p) => p.contentHtml.includes("uploads/data/"))).toHaveLength(2);
    expect(out.media.filter((m) => m.source.type === "extracted")).toHaveLength(1);
  });
});

describe("extractUploadPaths", () => {
  it("抽取并归一;引号/空白截断;去重", () => {
    const paths = extractUploadPaths(
      '<img src="/wp-content/uploads/2024/04/%e5%9b%be.png"><a href="/wp-content/uploads/2024/04/doc.pdf">x</a>' +
        '<img src="/wp-content/uploads/2024/04/%e5%9b%be.png"><code>not /fake</code>',
    );
    expect(paths).toEqual([
      "/wp-content/uploads/2024/04/%e5%9b%be.png",
      "/wp-content/uploads/2024/04/doc.pdf",
    ]);
  });
});

describe("transformUsers(03 §6)", () => {
  const user = (over: Partial<WpUserRow>): WpUserRow => ({
    ID: 1,
    user_login: "user1",
    user_email: "a@b.c",
    user_registered: "2024-01-01 00:00:00",
    user_pass: "$P$Bhash",
    display_name: "用户一",
    ...over,
  });

  it("手机号校验、admin 识别、nickname/bio 映射", () => {
    const { users } = transformUsers(
      [user({ ID: 1, user_login: "admin" }), user({ ID: 2 }), user({ ID: 3 })],
      [
        { user_id: 1, meta_key: "wp_capabilities", meta_value: 'a:1:{s:13:"administrator";b:1;}' },
        { user_id: 1, meta_key: "mobile_phone", meta_value: "13800000001" },
        { user_id: 2, meta_key: "mobile_phone", meta_value: "13800000002" },
        { user_id: 2, meta_key: "nickname", meta_value: "昵称" },
        { user_id: 3, meta_key: "mobile_phone", meta_value: "12345" }, // 非法
      ] satisfies WpUserMetaRow[],
    );
    expect(users).toHaveLength(3);
    expect(users[0]).toMatchObject({ role: "admin", status: "active", phone: "13800000001" });
    expect(users[1]).toMatchObject({ role: "user", status: "active", nickname: "昵称" });
    expect(users[2]).toMatchObject({ status: "pending_binding", phone: null });
  });

  it("重复手机号:最早注册者保留,其余 pending_binding", () => {
    const { users, warnings } = transformUsers(
      [
        user({ ID: 1, user_registered: "2024-01-01 00:00:00" }),
        user({ ID: 2, user_registered: "2023-01-01 00:00:00" }),
      ],
      [
        { user_id: 1, meta_key: "mobile_phone", meta_value: "13800000001" },
        { user_id: 2, meta_key: "mobile_phone", meta_value: "13800000001" },
      ] satisfies WpUserMetaRow[],
    );
    const byId = new Map(users.map((u) => [u.wpUserId, u]));
    expect(byId.get(2)?.phone).toBe("13800000001"); // 更早注册者胜出
    expect(byId.get(1)).toMatchObject({ phone: null, status: "pending_binding" });
    expect(warnings.some((w) => w.scope === "user.phone_duplicate")).toBe(true);
  });
});

describe("buildLegacyMap(03 §8)", () => {
  const baseInput = () => ({
    posts: [
      post({ ID: 201, post_name: "news-slug", post_type: "post" }),
      post({ ID: 202, post_name: "%e4%b8%bb%e9%a1%b5", post_title: "主页", post_type: "page" }),
      post({ ID: 203, post_name: "login", post_title: "登录页面", post_type: "page" }),
      post({
        ID: 204,
        post_name: "%e7%94%a8%e6%88%b7%e5%8d%8f%e8%ae%ae",
        post_title: "用户协议",
        post_type: "page",
      }),
    ],
    legacyPosts: [{ ID: 301, post_name: "qa-1", post_type: "qa_post", post_title: "问" }],
    terms: [
      term(27, "news", "category"),
      term(28, "blog", "category"),
      term(9, "python%e5%9f%ba%e7%a1%80", "post_tag"),
    ],
    rels: [
      { object_id: 201, term_id: 27, taxonomy: "category" },
      { object_id: 999, term_id: 9, taxonomy: "post_tag" },
    ] satisfies WpRelRow[],
    scopedWpIds: new Set([999]), // 201(资讯)范围外;999 范围内但 rels 是标签
    migratedTagSlugs: new Set<string>(["mcp"]),
  });

  it("资讯 301 到 /articles;页面按规则;qa 类型 → /;未迁移标签归档 → /articles", () => {
    const { legacyMap } = buildLegacyMap(baseInput());
    const byPath = new Map(legacyMap.map((m) => [m.oldPath, m]));
    expect(byPath.get("/news-slug/")).toMatchObject({ targetUrl: "/articles" });
    expect(byPath.get("/%e4%b8%bb%e9%a1%b5/")).toMatchObject({ targetUrl: "/" });
    expect(byPath.get("/login/")).toMatchObject({ targetUrl: "/login" });
    expect(byPath.get("/%e7%94%a8%e6%88%b7%e5%8d%8f%e8%ae%ae/")).toMatchObject({
      targetUrl: "/agreement",
    });
    expect(byPath.get("/qa-1/")).toMatchObject({ targetUrl: "/" });
    expect(byPath.get("/tag/python%e5%9f%ba%e7%a1%80/")).toMatchObject({ targetUrl: "/articles" });
    expect(byPath.get("/category/news/")).toMatchObject({ targetUrl: "/articles" });
    expect(byPath.get("/category/blog/")).toBeUndefined(); // 迁移分类新站直出
  });

  it("范围内文章 slug 不入映射(新站 200 直出)", () => {
    const input = baseInput();
    input.rels.push({ object_id: 999, term_id: 28, taxonomy: "category" });
    input.posts.push(post({ ID: 999, post_name: "kept-post", post_type: "post" }));
    const { legacyMap } = buildLegacyMap(input);
    expect(legacyMap.find((m) => m.oldPath === "/kept-post/")).toBeUndefined();
  });
});
