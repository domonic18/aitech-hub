/**
 * 网关契约对拍(TS 侧):黄金样本 fixtures 在网关侧
 * services/douyin-gateway/contract/(pytest --bless 生成,网关是契约所有者)。
 * 本文件 strict 解析全部样本——网关加/改字段 → fixture 变 → 这里红逼同步;
 * 运行时解析走 gateway-contract.ts 宽容版(单条脏数据不炸整包),strict 只在测试期。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  gatewayErrorSchema,
  gatewayHealthSchema,
  playUrlRequestSchema,
  playUrlResponseSchema,
  postsRequestSchema,
  postsResponseSchema,
  profileResponseSchema,
  resolveResponseSchema,
  subtitleRequestSchema,
  subtitleResponseSchema,
} from "./gateway-contract";

const CONTRACT_DIR = fileURLToPath(
  new URL("../../../../../services/douyin-gateway/contract/", import.meta.url),
);

interface Fixture {
  status: number;
  body: unknown;
}

function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(`${CONTRACT_DIR}${name}.json`, "utf8")) as Fixture;
}

describe("契约黄金样本:成功响应 strict 对拍", () => {
  it("posts.success(douyin):VideoOut 全字段 + has_more/max_cursor 包络", () => {
    const f = fixture("posts.success");
    expect(f.status).toBe(200);
    const parsed = postsResponseSchema.strict().parse(f.body);
    expect(parsed.videos).toHaveLength(1);
    // 逐字段钉住(加字段 fixture 先红,这里防误删)
    const video = parsed.videos[0]!;
    expect(Object.keys(video).sort()).toEqual(
      [
        "caption",
        "comment_count",
        "cover_url",
        "digg_count",
        "duration_seconds",
        "play_count",
        "play_url",
        "published_at",
        "share_count",
        "topic_tags",
        "video_id",
      ].sort(),
    );
    expect(typeof video.video_id).toBe("string");
    expect(typeof video.published_at).toBe("string"); // ISO 字符串
    expect(video.play_count).toBeNull(); // douyin 恒 null
    expect(typeof parsed.max_cursor).toBe("number"); // 可超 JS safe-integer,仅翻页游标不回写
  });

  it("profile.success / resolve.success / health.success", () => {
    expect(profileResponseSchema.strict().parse(fixture("profile.success").body)).toMatchObject({
      nickname: "AI 前沿",
    });
    expect(resolveResponseSchema.strict().parse(fixture("resolve.success").body)).toHaveProperty(
      "sec_uid",
    );
    const health = gatewayHealthSchema.strict().parse(fixture("health.success").body);
    expect(health).toMatchObject({ jars_total: 3, jars_available: 2 });
    // per-platform 段:顶层 jars_* 仍 = douyin
    expect(Object.keys(health.platforms).sort()).toEqual(["bilibili", "douyin"]);
    expect(health.platforms.douyin).toMatchObject({ jars_total: 3, jars_available: 2 });
    expect(health.platforms.bilibili).toMatchObject({
      jars_total: 1,
      jars_available: 1,
      wbi_age_seconds: 3600,
    });
  });
});

describe("契约黄金样本:bilibili 面 strict 对拍", () => {
  it("posts.bilibili.success:bvid 主键 + play_count 有值 + listing 无直链", () => {
    const f = fixture("posts.bilibili.success");
    expect(f.status).toBe(200);
    const parsed = postsResponseSchema.strict().parse(f.body);
    const video = parsed.videos[0]!;
    expect(video.video_id).toMatch(/^BV/);
    expect(video.play_count).toBe(52341); // 仅 bilibili 有值
    expect(video.digg_count).toBeNull(); // vlist 无点赞
    expect(video.play_url).toBeNull(); // 解读现查,listing 不带直链
  });

  it("posts.bilibili.risk_control:错误名与 douyin 同构(归因零感知)", () => {
    const f = fixture("posts.bilibili.risk_control");
    expect(f.status).toBe(502);
    expect(gatewayErrorSchema.parse(f.body)).toMatchObject({ error: "RiskControlError" });
  });

  it("profile.bilibili.success / resolve.bilibili.success", () => {
    const profile = profileResponseSchema.strict().parse(fixture("profile.bilibili.success").body);
    expect(profile.sec_uid).toMatch(/^\d{1,16}$/);
    expect(profile.nickname).toBe("AI 技术漫谈");
    const resolved = resolveResponseSchema.strict().parse(fixture("resolve.bilibili.success").body);
    expect(resolved.sec_uid).toBe("9469941");
  });

  it("playurl.success:{video_id, play_url|null}(play_url 版权红线仅过境)", () => {
    const f = fixture("playurl.success");
    expect(f.status).toBe(200);
    const parsed = playUrlResponseSchema.strict().parse(f.body);
    expect(parsed.video_id).toMatch(/^BV/);
    expect(typeof parsed.play_url).toBe("string");
    expect(parsed.play_url).toContain("bilivideo.com");
  });

  it("subtitle.success:{video_id, subtitle_text, lang}(文本是转写输入非资产,禁落库)", () => {
    const f = fixture("subtitle.success");
    expect(f.status).toBe(200);
    const parsed = subtitleResponseSchema.strict().parse(f.body);
    expect(parsed.video_id).toMatch(/^BV/);
    expect(typeof parsed.subtitle_text).toBe("string");
    expect(parsed.lang).toBe("ai-zh"); // 择优后语种:ai-zh > zh-CN > zh-Hans > 首个
  });

  it("error.bilibili.validation:douyin 请求 /play-url 被 422 拒", () => {
    const f = fixture("error.bilibili.validation");
    expect(f.status).toBe(422);
    const parsed = gatewayErrorSchema.parse(f.body);
    expect(Array.isArray(parsed.detail)).toBe(true);
    expect(parsed.error).toBeUndefined();
  });
});

describe("契约黄金样本:错误包络对拍", () => {
  it("502 风控 / 404 账号失效:{error, detail} 双字段", () => {
    const risk = fixture("posts.risk_control");
    expect(risk.status).toBe(502);
    expect(gatewayErrorSchema.parse(risk.body)).toMatchObject({ error: "RiskControlError" });

    const invalid = fixture("profile.account_invalid");
    expect(invalid.status).toBe(404);
    expect(gatewayErrorSchema.parse(invalid.body)).toMatchObject({
      error: "AccountInvalidError",
    });
  });

  it("422 pydantic 校验:{detail: 数组}(无 error 字段)", () => {
    const f = fixture("error.validation");
    expect(f.status).toBe(422);
    const parsed = gatewayErrorSchema.parse(f.body);
    expect(Array.isArray(parsed.detail)).toBe(true);
    expect(parsed.error).toBeUndefined();
  });
});

describe("边界负例:schema 拒绝面", () => {
  it("postsRequest(douyin):sec_uid 过短/max_pages 越界拒绝;max_pages 默认 1", () => {
    expect(postsRequestSchema.safeParse({ sec_uid: "short" }).success).toBe(false);
    expect(
      postsRequestSchema.safeParse({ sec_uid: "MS4wLjABAAAA1234567890", max_pages: 4 }).success,
    ).toBe(false);
    expect(postsRequestSchema.parse({ sec_uid: "MS4wLjABAAAA1234567890" }).max_pages).toBe(1);
  });

  it("postsRequest(bilibili):mid 形态矩阵与网关一致", () => {
    expect(postsRequestSchema.safeParse({ platform: "bilibili", sec_uid: "9469941" }).success).toBe(
      true,
    );
    expect(
      postsRequestSchema.safeParse({ platform: "bilibili", sec_uid: "BV1xx411c7mD" }).success,
    ).toBe(false);
    // douyin 默认平台不受 bilibili 分支影响
    expect(
      postsRequestSchema.safeParse({ platform: "bilibili", sec_uid: "MS4wLjABAAAA1234567890" })
        .success,
    ).toBe(false);
  });

  it("playUrlRequest:BV 形态 + 仅 bilibili", () => {
    expect(playUrlRequestSchema.safeParse({ video_id: "BV1xx411c7mD" }).success).toBe(true);
    expect(playUrlRequestSchema.safeParse({ video_id: "av170001" }).success).toBe(false);
    expect(
      playUrlRequestSchema.safeParse({ platform: "douyin", video_id: "BV1xx411c7mD" }).success,
    ).toBe(false);
  });

  it("subtitleRequest:与 playUrl 同矩阵(BV 形态 + 仅 bilibili + 代理可选)", () => {
    expect(subtitleRequestSchema.safeParse({ video_id: "BV1xx411c7mD" }).success).toBe(true);
    expect(subtitleRequestSchema.safeParse({ video_id: "av170001" }).success).toBe(false);
    expect(
      subtitleRequestSchema.safeParse({ platform: "douyin", video_id: "BV1xx411c7mD" }).success,
    ).toBe(false);
    expect(
      subtitleRequestSchema.safeParse({ video_id: "BV1xx411c7mD", proxy: "http://192.0.2.1:7890" })
        .success,
    ).toBe(true);
  });

  it("postsResponse 包络必填:缺 has_more/max_cursor 拒绝", () => {
    expect(postsResponseSchema.safeParse({ videos: [], has_more: false }).success).toBe(false);
    expect(postsResponseSchema.safeParse({ videos: [] }).success).toBe(false);
  });

  it("strict:成功响应混入未知字段拒绝(加字段必须同步契约)", () => {
    const drifted = {
      ...(fixture("posts.success").body as Record<string, unknown>),
      extra_field: 1,
    };
    expect(postsResponseSchema.strict().safeParse(drifted).success).toBe(false);
  });

  it("videoOut 宽容:缺 video_id 的单条仍通过(TS 侧=脏数据丢弃语义;网关侧 pytest 钉必填)", () => {
    const f = fixture("posts.success");
    const body = f.body as { videos: Array<Record<string, unknown>> };
    const dirty = { ...body, videos: [{ caption: "脏数据" }] };
    const parsed = postsResponseSchema.parse(dirty);
    expect(parsed.videos[0]?.video_id).toBeNull();
  });
});
