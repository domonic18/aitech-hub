/**
 * L0 预筛单测:规则三分命中短路顺序、视频场景仅标题维度、无命中放行。
 */
import { describe, expect, it } from "vitest";

import { l0Check } from "./l0";

describe("l0Check", () => {
  it("名称命中黑名单即 reject,理由带命中词", () => {
    const r = l0Check({ name: "AI 前沿学院", sampleTitles: ["Transformer 入门"] });
    expect(r.verdict).toBe("reject");
    expect(r.reason).toBe("名称命中营销特征词:学院");
  });

  it("名称干净但标题命中黑名单即 reject(同句多词按词表声明序取首个)", () => {
    const r = l0Check({ name: "极客小张", sampleTitles: ["2026 最新 AI 资源合集"] });
    expect(r.verdict).toBe("reject");
    expect(r.reason).toBe("标题命中营销特征词:资源");
  });

  it("标题黑名单优先于矩阵名与教学信号(短路顺序 1→2→3)", () => {
    const r = l0Check({ name: "AI教程号1234", sampleTitles: ["副业变现指南"] });
    expect(r.verdict).toBe("reject");
    expect(r.reason).toBe("标题命中营销特征词:副业");
  });

  it("矩阵名:主账号特征词 reject(避开黑名单词的用例)", () => {
    const r = l0Check({ name: "某某主账号", sampleTitles: ["新品发布"] });
    expect(r.verdict).toBe("reject");
    expect(r.reason).toBe("名称含矩阵号特征:主账号");
  });

  it("矩阵名:长数字尾 reject(≥4 位)", () => {
    const expectReject = l0Check({ name: "科技速递2024", sampleTitles: ["新品评测"] });
    expect(expectReject.verdict).toBe("reject");
    expect(expectReject.reason).toBe("名称带长数字尾,疑似矩阵批量号");
    // 3 位数字尾不算(常见正常命名)
    const ok = l0Check({ name: "频道302", sampleTitles: ["杂谈"] });
    expect(ok.verdict).toBe("pass");
  });

  it("教学向信号 pass 提权,理由带命中词", () => {
    const r = l0Check({ name: "老王聊技术", sampleTitles: ["Rust 入门第一课"] });
    expect(r.verdict).toBe("pass");
    expect(r.reason).toBe("标题命中教学向信号:入门");
  });

  it("无任何命中 pass(漏杀成本高于误放,人工终审兜底)", () => {
    const r = l0Check({ name: "随机漫步", sampleTitles: ["一次深夜漫谈"] });
    expect(r).toEqual({ verdict: "pass", reason: "无负面信号" });
  });

  it("video 场景 name 为空:仅标题维度参与判定", () => {
    const reject = l0Check({ name: null, sampleTitles: ["网课推广,速来"] });
    expect(reject.verdict).toBe("reject");
    // 名字即便像矩阵号,video 场景也不看名称维度
    const pass = l0Check({ name: null, sampleTitles: ["这个渲染管线有点东西"] });
    expect(pass.verdict).toBe("pass");
  });

  it("标题样本去空白后判定,全空白样本等价无标题", () => {
    const r = l0Check({ name: "  ", sampleTitles: ["  ", ""] });
    expect(r).toEqual({ verdict: "pass", reason: "无负面信号" });
  });
});
