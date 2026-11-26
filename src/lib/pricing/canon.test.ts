/**
 * 型号归一·能力维度单测:跨源异写收敛口径 + 防误并纪律。
 * 用例全部来自生产实测的跨源分裂形态(词元所裸键 ↔ 百炼能力后缀)。
 */
import { describe, expect, it } from "vitest";

import { groupOf } from "./canon";

describe("groupOf 能力后缀剥离", () => {
  it("百炼能力后缀 ↔ 词元所裸键 → 同组(kling 系)", () => {
    const a = groupOf("kling/kling-v3-video-generation", "video", "aliyun-bailian");
    const b = groupOf("kling-v3", "video", "baidu-ciyuansuo");
    expect(a.groupKey).toBe("kling-v3::t2v");
    expect(b.groupKey).toBe(a.groupKey);
  });

  it("同基型不同任务不误并(t2v/i2v/r2v 各自成组)", () => {
    expect(groupOf("viduq3-pro_text2video", "video").groupKey).toBe("viduq3-pro::t2v");
    expect(groupOf("viduq3-pro_img2video", "video").groupKey).toBe("viduq3-pro::i2v");
    expect(groupOf("viduq3-pro_start-end2video", "video").groupKey).toBe("viduq3-pro::se2v");
    expect(groupOf("viduq3-pro_reference2video", "video").groupKey).toBe("viduq3-pro::r2v");
  });

  it("裸键按模态主任务:词元所 viduq3-pro 与百炼 text2video 同组", () => {
    expect(groupOf("viduq3-pro", "video").groupKey).toBe("viduq3-pro::t2v");
  });

  it("图像系:t2i/i2i/r2i 与裸键默认", () => {
    expect(groupOf("kling/kling-v3-image-generation", "image").groupKey).toBe("kling-v3::t2i");
    expect(groupOf("wan2.6-image", "image").groupKey).toBe("wan2-6-image::t2i");
    expect(groupOf("Kolors", "image").groupKey).toBe("kolors::t2i");
  });

  it("后缀任务的模态与模型模态不一致 → 保留原键不剥(宁可分裂)", () => {
    // -video-generation 是视频任务,但源显式说 image(数据矛盾)
    const g = groupOf("kling-v3-video-generation", "image");
    expect(g.groupKey).toBe("kling-v3-video-generation::t2i");
  });

  it("org 前缀先剥(Kwai-Kolors/Kolors → kolors)", () => {
    expect(groupOf("Kwai-Kolors/Kolors", "image").groupKey).toBe("kolors::t2i");
  });

  it("中文附注被归一折叠:doubao-seedream-5-0-pro按生图场景区分定价", () => {
    const g = groupOf("doubao-seedream-5-0-pro按生图场景区分定价", "image");
    expect(g.groupKey).toBe("doubao-seedream-5-0-pro::t2i");
    expect(groupOf("doubao-seedream-5-0-pro", "image").groupKey).toBe(g.groupKey);
  });

  it("文本模态:任务词=模态名,不套 t2v/t2i", () => {
    expect(groupOf("deepseek-v3.2", "text").groupKey).toBe("deepseek-v3-2::text");
    expect(groupOf("Pro/BAAI/bge-m3", "embedding").groupKey).toBe("bge-m3::embedding");
  });

  it("未知后缀不剥(-omni/-vace 保留在基型里)", () => {
    expect(groupOf("kling-v3-omni", "video").groupKey).toBe("kling-v3-omni::t2v");
    expect(groupOf("wan2.1-vace-plus", "video").groupKey).toBe("wan2-1-vace-plus::t2v");
    // omni 的能力后缀形态仍可归一
    expect(groupOf("kling/kling-v3-omni-video-generation", "video").groupKey).toBe(
      "kling-v3-omni::t2v",
    );
  });

  it("空键 → groupKey 空串(不落库)", () => {
    expect(groupOf("", "text").groupKey).toBe("");
  });
});

describe("groupOf 源作用域别名", () => {
  it("词元所裸版本号 v6/v5.6 → pixverse 基型", () => {
    expect(groupOf("v6", "video", "baidu-ciyuansuo").groupKey).toBe("pixverse-v6::t2v");
    expect(groupOf("v5.6", "video", "baidu-ciyuansuo").groupKey).toBe("pixverse-v5-6::t2v");
  });

  it("别名只在源内生效:其他源的 v6 不套别名", () => {
    expect(groupOf("v6", "video", "aliyun-bailian").groupKey).toBe("v6::t2v");
    expect(groupOf("v6", "video", null).groupKey).toBe("v6::t2v");
  });
});
