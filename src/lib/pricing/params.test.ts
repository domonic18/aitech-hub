/**
 * 档位参数解析单测(P3):标签 → resolution/hasAudio/durationSec/fps,
 * 以及 DB 显式参数 vs 标签兜底的 source 标记。
 */
import { describe, expect, it } from "vitest";

import { parseTierParams, tierParamsWithFallback, type TierParams } from "./params";

describe("parseTierParams", () => {
  it("分辨率复用传入值;其余维度按标签解析", () => {
    expect(parseTierParams("默认", "1k")).toEqual({
      resolution: "1k",
      hasAudio: null,
      durationSec: null,
      fps: null,
    });
  });

  it("识别有声/无声与 audio=true/false", () => {
    expect(parseTierParams("有声视频·720P", "720P")).toMatchObject({
      resolution: "720P",
      hasAudio: true,
    });
    expect(parseTierParams("无声·5s", null)).toMatchObject({
      hasAudio: false,
      durationSec: 5,
    });
    expect(parseTierParams("audio=true", null)).toMatchObject({ hasAudio: true });
    expect(parseTierParams("audio=false", null)).toMatchObject({ hasAudio: false });
  });

  it("识别时长与帧率", () => {
    expect(parseTierParams("10 秒·24fps", null)).toEqual({
      resolution: null,
      hasAudio: null,
      durationSec: 10,
      fps: 24,
    });
    expect(parseTierParams("30 帧", null)).toMatchObject({ fps: 30 });
    expect(parseTierParams("5.5s", null)).toMatchObject({ durationSec: 5.5 });
  });

  it("解析不到的维度为 null,不臆测", () => {
    expect(parseTierParams("默认", null)).toEqual({
      resolution: null,
      hasAudio: null,
      durationSec: null,
      fps: null,
    });
    expect(parseTierParams("面议", null)).toEqual({
      resolution: null,
      hasAudio: null,
      durationSec: null,
      fps: null,
    });
  });
});

describe("tierParamsWithFallback", () => {
  it("DB 显式参数 → source=parsed", () => {
    const db: TierParams = {
      resolution: "2k",
      hasAudio: true,
      durationSec: 5,
      fps: 30,
    };
    const result = tierParamsWithFallback(db, "有声视频·2k", "2k");
    expect(result).toEqual({ ...db, source: "parsed" });
  });

  it("DB 为空 → 按标签推断,source=inferred", () => {
    const result = tierParamsWithFallback(null, "无声·10 秒", null);
    expect(result).toEqual({
      resolution: null,
      hasAudio: false,
      durationSec: 10,
      fps: null,
      source: "inferred",
    });
  });

  it("DB 为空且标签也表达不出参数 → 返回 null", () => {
    expect(tierParamsWithFallback(null, "默认", null)).toBeNull();
    expect(tierParamsWithFallback(undefined, "", null)).toBeNull();
  });

  it("DB 形态不对 → 退到标签推断", () => {
    expect(tierParamsWithFallback("bad", "720P", "720P")).toEqual({
      resolution: "720P",
      hasAudio: null,
      durationSec: null,
      fps: null,
      source: "inferred",
    });
  });
});
