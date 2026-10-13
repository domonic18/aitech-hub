/**
 * 专题合成 agent 管线单测(M27 批③):角度/自检契约解析(合法/围栏/越界/
 * 缺字段)、入队防线(未绑模型 400 / 同专题进行中 409 / jobId 确定性)、轮询
 * 状态映射(idle/done/failed/running)。四步 LLM 编排与落稿不入单测(依赖
 * 真模型与 DB,由本地真机验收覆盖;解析失败重试语义由 chatJsonTask 层保证)。
 */
import { describe, expect, it, vi } from "vitest";

const getJob = vi.hoisted(() => vi.fn());
const add = vi.hoisted(() => vi.fn());
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// queue 顶层 import env(启动期校验),单测进程无 env → 打桩
vi.mock("../queue", () => ({
  getQueue: () => ({ getJob, add }),
  QUEUE_TOPIC_COMPOSE: "topic-compose",
  TOPIC_COMPOSE_JOB: "compose",
}));

import { enqueueTopicCompose, getTopicComposeState } from "./compose-agent";
import { parseAngle, parseCheck } from "./compose-prompt";
import { TopicError } from "./repo";
import { AiAdminError } from "../ai/errors";

// compose 绑定模型打桩(enqueue 防线依赖;unbound 用例单点覆写)
const resolveAiModel = vi.hoisted(() => vi.fn());
vi.mock("../ai/resolver", () => ({ resolveAiModel }));
resolveAiModel.mockResolvedValue({ id: 1, modelId: "m" });

// ── 契约解析 ───────────────────────────────────────────────

const angleJson = JSON.stringify({
  candidates: [
    { title: "角度A", hook: "钩子A", reason: "理由A" },
    { title: "角度B", hook: "钩子B", reason: "理由B" },
  ],
  chosen: 2,
});

describe("parseAngle(角度择优契约)", () => {
  it("合法 JSON(含代码围栏)透传;chosen 2 取第二候选", () => {
    const r = parseAngle(`\`\`\`json\n${angleJson}\n\`\`\``);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.chosen).toBe(2);
      expect(r.data.candidates).toHaveLength(2);
    }
  });

  it("chosen 越界/候选不足/无 JSON → ok:false", () => {
    expect(
      parseAngle(
        JSON.stringify({ candidates: [{ title: "a", hook: "b", reason: "c" }], chosen: 1 }),
      ).ok,
    ).toBe(false);
    expect(parseAngle(JSON.stringify({ ...JSON.parse(angleJson), chosen: 5 })).ok).toBe(false);
    expect(parseAngle("不是 JSON").ok).toBe(false);
  });
});

describe("parseCheck(自检契约)", () => {
  it("pass+issues 透传;issues 缺省补空数组", () => {
    const pass = parseCheck(JSON.stringify({ pass: true, issues: ["要点超 60 字"] }));
    expect(pass.ok).toBe(true);
    if (pass.ok) expect(pass.data.issues).toEqual(["要点超 60 字"]);
    const bare = parseCheck(JSON.stringify({ pass: false }));
    expect(bare.ok).toBe(true);
    if (bare.ok) expect(bare.data.issues).toEqual([]);
  });

  it("issues 超上限/非布尔/无 JSON → ok:false", () => {
    expect(parseCheck(JSON.stringify({ pass: true, issues: Array(7).fill("x") })).ok).toBe(false);
    expect(parseCheck(JSON.stringify({ pass: "yes" })).ok).toBe(false);
    expect(parseCheck("nope").ok).toBe(false);
  });
});

// ── 入队防线与轮询映射 ─────────────────────────────────────

describe("enqueueTopicCompose(入队防线)", () => {
  it("未绑模型 → AiAdminError(disabled) 先于任何 Redis 触达", async () => {
    resolveAiModel.mockResolvedValueOnce(null);
    await expect(enqueueTopicCompose(BigInt(7))).rejects.toBeInstanceOf(AiAdminError);
    expect(getJob).not.toHaveBeenCalled();
  });

  it("同专题 active job → TopicError(conflict) 拒重;ok 路径以确定性 jobId 入队", async () => {
    getJob.mockResolvedValueOnce({ getState: async () => "active" });
    await expect(enqueueTopicCompose(BigInt(7))).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("正在合成中"),
    });
    getJob.mockResolvedValueOnce(null);
    await enqueueTopicCompose(BigInt(7));
    expect(add).toHaveBeenCalledWith(
      "compose",
      { topicId: "7" },
      expect.objectContaining({ jobId: "topic-compose-7", attempts: 1 }),
    );
  });

  it("completed 旧 job 先删再入(确定性 jobId 是去重键,不清会静默丢弃重合成)", async () => {
    const remove = vi.fn();
    getJob.mockResolvedValueOnce({ getState: async () => "completed", remove });
    add.mockResolvedValueOnce(undefined);
    await expect(enqueueTopicCompose(BigInt(8))).resolves.toEqual({
      jobId: "topic-compose-8",
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("getTopicComposeState(轮询映射)", () => {
  it("无 job → idle", async () => {
    getJob.mockResolvedValueOnce(null);
    expect(await getTopicComposeState(BigInt(1))).toMatchObject({ state: "idle" });
  });

  it("completed → done 带 result;failed → failed 带 error", async () => {
    getJob.mockResolvedValueOnce({
      getState: async () => "completed",
      returnvalue: {
        postId: "9",
        postTitle: "t",
        recomposed: false,
        coverPath: null,
        fallback: false,
      },
    });
    expect(await getTopicComposeState(BigInt(1))).toMatchObject({
      state: "done",
      result: { postId: "9" },
    });
    getJob.mockResolvedValueOnce({ getState: async () => "failed", failedReason: "LLM 炸了" });
    expect(await getTopicComposeState(BigInt(1))).toMatchObject({
      state: "failed",
      error: "LLM 炸了",
    });
  });

  it("active 带 progress → running;waiting → queued", async () => {
    getJob.mockResolvedValueOnce({
      getState: async () => "active",
      progress: { step: 2, total: 4, label: "按固定结构起草" },
    });
    expect(await getTopicComposeState(BigInt(1))).toMatchObject({
      state: "running",
      progress: { step: 2 },
    });
    getJob.mockResolvedValueOnce({ getState: async () => "waiting", progress: null });
    expect(await getTopicComposeState(BigInt(1))).toMatchObject({ state: "queued" });
  });
});
