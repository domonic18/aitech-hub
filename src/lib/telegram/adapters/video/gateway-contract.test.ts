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
  postsRequestSchema,
  postsResponseSchema,
  profileResponseSchema,
  resolveResponseSchema,
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
  it("posts.success:VideoOut 全字段 + has_more/max_cursor 包络", () => {
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
        "play_url",
        "published_at",
        "share_count",
        "topic_tags",
        "video_id",
      ].sort(),
    );
    expect(typeof video.video_id).toBe("string");
    expect(typeof video.published_at).toBe("string"); // ISO 字符串
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
  it("postsRequest:sec_uid 过短/max_pages 越界拒绝;max_pages 默认 1", () => {
    expect(postsRequestSchema.safeParse({ sec_uid: "short" }).success).toBe(false);
    expect(
      postsRequestSchema.safeParse({ sec_uid: "MS4wLjABAAAA1234567890", max_pages: 4 }).success,
    ).toBe(false);
    expect(postsRequestSchema.parse({ sec_uid: "MS4wLjABAAAA1234567890" }).max_pages).toBe(1);
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
