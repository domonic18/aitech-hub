import { describe, expect, it } from "vitest";

import { inferModality, resolveModality } from "./modality";

describe("inferModality", () => {
  it("文生图:seedream 系列命中 image", () => {
    expect(inferModality("doubao-seedream-4-0")).toBe("image");
    expect(inferModality("doubao-seededit-3-0-i2i")).toBe("image");
    expect(inferModality("Kwai-Kolors/Kolors")).toBe("image");
    expect(inferModality("black-forest-labs/FLUX.1-schnell")).toBe("image");
    expect(inferModality("qwen-image")).toBe("image");
    expect(inferModality("Qwen/Qwen-Image")).toBe("image");
  });

  it("文生视频:seedance/wan t2v 命中 video", () => {
    expect(inferModality("doubao-seedance-1-0-pro")).toBe("video");
    expect(inferModality("Wan-AI/Wan2.2-T2V-A14B")).toBe("video");
    expect(inferModality("Wan-AI/Wan2.2-I2V-A14B")).toBe("video");
    expect(inferModality("hunyuan-video")).toBe("video");
    expect(inferModality("cogvideox-3")).toBe("video");
  });

  it("弱后缀图文:video/image 关键词都排过后才轮到 -vl", () => {
    expect(inferModality("Qwen/Qwen2.5-VL-72B-Instruct")).toBe("text+vision");
    expect(inferModality("glm-4v-flash")).toBe("text+vision");
    expect(inferModality("internvl3-8b")).toBe("text+vision");
  });

  it("向量/重排/音频", () => {
    expect(inferModality("BAAI/bge-m3")).toBe("embedding");
    expect(inferModality("text-embedding-v4")).toBe("embedding");
    expect(inferModality("Qwen3-Embedding-4B")).toBe("embedding");
    expect(inferModality("Qwen3-Reranker-8B")).toBe("rerank");
    expect(inferModality("FunAudioLLM/CosyVoice2-0.5B")).toBe("audio");
    expect(inferModality("tts-1-hd")).toBe("audio");
  });

  it("纯文本模型认不出 → null(不猜)", () => {
    expect(inferModality("deepseek-v3.2")).toBeNull();
    expect(inferModality("Qwen/Qwen3-235B-A22B")).toBeNull();
    expect(inferModality("doubao-seed-1.6")).toBeNull();
    expect(inferModality("moonshot-v1-8k")).toBeNull();
  });
});

describe("resolveModality", () => {
  it("字典现值非 text:保持,不降级不改判", () => {
    expect(resolveModality(null, "deepseek-v3.2", "image")).toBe("image");
    expect(resolveModality("video", "doubao-seedream-4-0", "image")).toBe("image");
  });

  it("现值 text/空:显式标注赢", () => {
    expect(resolveModality("image", "anything", "text")).toBe("image");
    expect(resolveModality("video", "anything", "")).toBe("video");
  });

  it("现值 text/空且无显式:关键词升级,认不出落 text", () => {
    expect(resolveModality(null, "doubao-seedream-4-0", "text")).toBe("image");
    expect(resolveModality(null, "doubao-seedream-4-0", null)).toBe("image");
    expect(resolveModality(null, "deepseek-v3.2", "text")).toBe("text");
    expect(resolveModality(undefined, "deepseek-v3.2", null)).toBe("text");
  });
});
