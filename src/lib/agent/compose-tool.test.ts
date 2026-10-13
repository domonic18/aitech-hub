/**
 * compose_topic_draft 工具单测(compose-agent/prisma/logger 必 mock):admin
 * 会话行归属 fail-closed 防线、资格预检透传(素材空/needConfirm)、enqueue
 * 业务降级(未绑模型/409 进行中)人话回传、轮询终态映射(done/failed)与
 * 6 分钟超时。LLM 管线本身不入单测(compose-agent 侧已覆盖)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  searchAgentSession: { findUnique: vi.fn() },
}));
const checkComposeEligibility = vi.hoisted(() => vi.fn());
const enqueueTopicCompose = vi.hoisted(() => vi.fn());
const getTopicComposeState = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../topics/compose-agent", () => ({
  checkComposeEligibility,
  enqueueTopicCompose,
  getTopicComposeState,
}));

import { AiAdminError } from "../ai/errors";
import { TopicError } from "../topics/repo";
import { composeTopicDraftTool } from "./compose-tool";

const TID = "sess-1";
const invoke = (
  args: { topic_id: string; confirm?: boolean },
  threadId: unknown = TID,
): Promise<string> =>
  composeTopicDraftTool.invoke(args, { configurable: { thread_id: threadId } }) as Promise<string>;

beforeEach(() => {
  prismaMock.searchAgentSession.findUnique.mockReset();
  checkComposeEligibility.mockReset();
  enqueueTopicCompose.mockReset();
  getTopicComposeState.mockReset();
  // 默认 admin 会话行(非 admin 用例单点覆写)
  prismaMock.searchAgentSession.findUnique.mockResolvedValue({ visitorId: "admin:1" });
  checkComposeEligibility.mockResolvedValue({ ok: true });
  enqueueTopicCompose.mockResolvedValue({ jobId: "topic-compose-7" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("身份防线(fail-closed)", () => {
  it("会话行缺失/非 admin 归属/无 thread_id → 拒且不入队", async () => {
    prismaMock.searchAgentSession.findUnique.mockResolvedValue(null);
    expect(JSON.parse(await invoke({ topic_id: "7" })).ok).toBe(false);
    prismaMock.searchAgentSession.findUnique.mockResolvedValue({ visitorId: "user:9" });
    expect(JSON.parse(await invoke({ topic_id: "7" })).ok).toBe(false);
    expect(JSON.parse(await invoke({ topic_id: "7" }, undefined)).ok).toBe(false);
    expect(enqueueTopicCompose).not.toHaveBeenCalled();
  });
});

describe("资格预检与业务降级透传", () => {
  it("素材空 → ok:false 人话;needConfirm 透传且 confirm 重调带入", async () => {
    checkComposeEligibility.mockResolvedValue({
      ok: false,
      message: "尚未挂载素材——先挂 2~3 条解读/文章再合成",
    });
    expect(JSON.parse(await invoke({ topic_id: "7" }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("尚未挂载素材"),
    });
    checkComposeEligibility.mockResolvedValue({
      ok: false,
      message: "关联文档在合成后被人工编辑过——确认覆盖吗?",
      needConfirm: true,
    });
    expect(JSON.parse(await invoke({ topic_id: "7" }))).toMatchObject({ needConfirm: true });
    await invoke({ topic_id: "7", confirm: true });
    expect(checkComposeEligibility).toHaveBeenLastCalledWith(BigInt(7), true);
  });

  it("未绑模型(AiAdminError)/进行中(TopicError conflict)→ 人话回传不抛", async () => {
    enqueueTopicCompose.mockRejectedValue(
      new AiAdminError("disabled", "请先在 AI 配置为「专题合成」绑定主模型"),
    );
    expect(JSON.parse(await invoke({ topic_id: "7" }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("绑定主模型"),
    });
    enqueueTopicCompose.mockRejectedValue(
      new TopicError("conflict", "该专题正在合成中,请等待完成后再试"),
    );
    expect(JSON.parse(await invoke({ topic_id: "7" }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("正在合成中"),
    });
  });
});

describe("轮询终态映射", () => {
  it("done → ok:true 带 postId/postUrl;failed → ok:false 带 error", async () => {
    getTopicComposeState
      .mockResolvedValueOnce({
        state: "queued",
        progress: null,
        result: null,
        error: null,
      })
      .mockResolvedValueOnce({
        state: "done",
        progress: null,
        result: {
          postId: "9",
          postTitle: "标题",
          recomposed: false,
          coverPath: "/m/c.jpg",
          fallback: false,
        },
        error: null,
      });
    vi.useFakeTimers();
    const p = invoke({ topic_id: "7" });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(JSON.parse(await p)).toMatchObject({
      ok: true,
      postId: "9",
      postUrl: "/admin/posts/9",
      coverPath: "/m/c.jpg",
    });
    getTopicComposeState.mockResolvedValueOnce({
      state: "failed",
      progress: null,
      result: null,
      error: "LLM 炸了",
    });
    expect(JSON.parse(await invoke({ topic_id: "7" }))).toMatchObject({
      ok: false,
      error: "LLM 炸了",
    });
  });

  it("超过 6 分钟未终态 → timeout 人话(任务仍在后台)", async () => {
    getTopicComposeState.mockResolvedValue({
      state: "running",
      progress: { step: 2, total: 4, label: "起草" },
      result: null,
      error: null,
    });
    vi.useFakeTimers();
    const p = invoke({ topic_id: "7" });
    await vi.advanceTimersByTimeAsync(6 * 60_000 + 4_000);
    expect(JSON.parse(await p)).toMatchObject({
      ok: false,
      timeout: true,
      error: expect.stringContaining("后台运行"),
    });
  });
});
