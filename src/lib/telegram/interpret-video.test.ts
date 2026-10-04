/**
 * 视频解读管道单测:prisma/queue/AI 客户端/ffmpeg/fs 全打桩,验状态机分支——
 * 幂等 skip、未配置不标败、配额顺延重投、ASR 三连败降级仍走 LLM、
 * LLM 解析败 failed 不烧 attempts、直链两路获取与过期回拉、临时文件即删。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  telegram: {
    findUnique: vi.fn<(args?: unknown) => Promise<unknown>>(),
    update: vi.fn<(args?: unknown) => Promise<unknown>>(async () => ({})),
    count: vi.fn<(args?: unknown) => Promise<unknown>>(async () => 0),
  },
  asrConfig: { findUnique: vi.fn<(args?: unknown) => Promise<unknown>>() },
  crawlSource: { findUnique: vi.fn<(args?: unknown) => Promise<unknown>>(async () => null) },
}));
vi.mock("../db", () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({
  add: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  remove: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
}));
vi.mock("../queue", () => ({ QUEUE_INTERPRETER: "interpreter", getQueue: () => queueMock }));

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// 日配额已后台化(M9 批⑥):经 resolver getRoleDailyMax 读 ai_task_binding.daily_max
vi.mock("../env", () => ({ env: {} }));

const dailyMaxMock = vi.hoisted(() => vi.fn<(args?: unknown) => Promise<number>>(async () => 2));

vi.mock("../ai/resolver", () => ({
  getRoleDailyMax: dailyMaxMock,
  resolveAiModel: vi.fn(async () => ({
    id: 1,
    name: "m",
    protocol: "openai",
    baseUrl: "https://llm.test/v1",
    modelId: "deepseek-chat",
    apiKey: "sk",
    timeoutSec: 60,
    concurrency: 1,
    supportsVision: false,
  })),
}));
vi.mock("../crypto/secret-box", () => ({ decryptSecret: vi.fn(() => "asr-key") }));

const transcribeMock = vi.hoisted(() =>
  vi.fn<(args: unknown) => Promise<string>>(async () => "转写全文"),
);
vi.mock("../ai/asr-client", () => ({ transcribeAudio: transcribeMock }));

// LLM 默认回合法 JSON(parseInterpretResult/buildInterpretPrompt 用真实现)
const GOOD_JSON = vi.hoisted(() =>
  JSON.stringify({ topic: "主题", summary: "概括内容", points: ["要点一"] }),
);
const chatJsonMock = vi.hoisted(() =>
  vi.fn<(args: unknown) => Promise<string>>(async () => GOOD_JSON),
);
vi.mock("../ai/llm-client", () => ({ chatJson: chatJsonMock }));

vi.mock("./cookies", () => ({ decryptJars: vi.fn(() => ["ck"]) }));

const fetchVideosMock = vi.hoisted(() =>
  vi.fn<(args: unknown) => Promise<Array<{ videoId: string; playUrl: string | null }>>>(
    async () => [],
  ),
);
vi.mock("./adapters/video/douyin", () => ({
  douyinAdapter: { fetchRecentVideos: fetchVideosMock },
}));

vi.mock("ffmpeg-static", () => ({ default: "/fake/ffmpeg" }));
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_file: string, _args: string[], cb: (e: Error | null) => void) => cb(null)),
}));

const fsMock = vi.hoisted(() => ({
  mkdtemp: vi.fn(async () => "/tmp/interpret-fake"),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from("audio-bytes")),
  rm: vi.fn<(args?: unknown) => Promise<void>>(async () => undefined),
}));
vi.mock("node:fs", () => ({ promises: fsMock }));

import { interpretVideoJob, type InterpretJobData } from "./interpret-video";

const ASR_ROW = {
  id: 1,
  enabled: true,
  protocol: "openai",
  baseUrl: "https://asr.test",
  modelId: "whisper-1",
  apiKeyEnc: "enc",
  maxAudioSeconds: 600,
  hotwords: ["大模型"],
};

const ROW = { id: 1, title: "标题", summary: "文案", aiStatus: null, sourceId: 10 };

const DATA: InterpretJobData = {
  telegramId: "1",
  videoId: "vid-1",
  playUrl: "https://v.douyinvod.com/x",
  platform: "douyin",
  secUid: "sec-abc",
};

function stubDownload(mode: "ok" | "fail-first" = "ok"): ReturnType<typeof vi.fn> {
  let called = 0;
  const fetchMock = vi.fn(async () => {
    called += 1;
    if (mode === "fail-first" && called === 1) throw new TypeError("fetch failed");
    return new Response(Buffer.from("video-bytes"), {
      status: 200,
      headers: { "content-length": "11" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.telegram.findUnique.mockResolvedValue(ROW);
  prismaMock.telegram.update.mockResolvedValue({});
  prismaMock.telegram.count.mockResolvedValue(0);
  prismaMock.asrConfig.findUnique.mockResolvedValue(ASR_ROW);
  prismaMock.crawlSource.findUnique.mockResolvedValue(null);
  transcribeMock.mockResolvedValue("转写全文");
  chatJsonMock.mockResolvedValue(GOOD_JSON);
  fetchVideosMock.mockResolvedValue([]);
  fsMock.mkdtemp.mockResolvedValue("/tmp/interpret-fake");
  fsMock.writeFile.mockResolvedValue(undefined);
  fsMock.readFile.mockResolvedValue(Buffer.from("audio-bytes"));
  fsMock.rm.mockResolvedValue(undefined);
  queueMock.add.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("interpretVideoJob 状态机", () => {
  it("成功全链:processing → done,ai_* 落库,临时目录即删,不再入队", async () => {
    stubDownload();
    const outcome = await interpretVideoJob(DATA);
    expect(outcome).toMatchObject({ telegramId: "1", status: "done", transcriptUsed: true });
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { aiStatus: "processing", lastAiError: null },
    });
    expect(prismaMock.telegram.update).toHaveBeenLastCalledWith({
      where: { id: BigInt(1) },
      data: {
        aiStatus: "done",
        aiTopic: "主题",
        aiSummary: "概括内容",
        aiPoints: ["要点一"],
        aiRanAt: expect.any(Date),
        lastAiError: null,
      },
    });
    expect(fsMock.rm).toHaveBeenCalledWith("/tmp/interpret-fake", { recursive: true, force: true });
    expect(queueMock.add).not.toHaveBeenCalled();
    expect(transcribeMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "asr-key", hotwords: ["大模型"], timeoutSec: 120 }),
    );
    expect(chatJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk",
        timeoutSec: 60,
        system: expect.stringContaining("JSON"),
      }),
    );
  });

  it("done 幂等 skip:不重复烧 ASR/LLM", async () => {
    prismaMock.telegram.findUnique.mockResolvedValue({ ...ROW, aiStatus: "done" });
    const outcome = await interpretVideoJob(DATA);
    expect(outcome.status).toBe("skipped_done");
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("行已删除 → skipped_not_found", async () => {
    prismaMock.telegram.findUnique.mockResolvedValue(null);
    expect((await interpretVideoJob(DATA)).status).toBe("skipped_not_found");
  });

  it("未配置(ASR 停用)→ skipped_not_ready:aiStatus 不动,仅落 lastAiError 提示", async () => {
    prismaMock.asrConfig.findUnique.mockResolvedValue({ ...ASR_ROW, enabled: false });
    const outcome = await interpretVideoJob(DATA);
    expect(outcome.status).toBe("skipped_not_ready");
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { lastAiError: expect.stringContaining("未启用") },
    });
  });

  it("interpret 角色未绑定 → skipped_not_ready", async () => {
    const { resolveAiModel } = await import("../ai/resolver");
    vi.mocked(resolveAiModel).mockResolvedValueOnce(null);
    expect((await interpretVideoJob(DATA)).status).toBe("skipped_not_ready");
  });

  it("日配额满 → 延迟 30min 重投新 jobId 顺延,不标败不入管道", async () => {
    prismaMock.telegram.count.mockResolvedValue(2); // == getRoleDailyMax mock(2)
    const outcome = await interpretVideoJob(DATA);
    expect(outcome.status).toBe("deferred_quota");
    expect(queueMock.add).toHaveBeenCalledWith(
      "interpret-video",
      DATA,
      expect.objectContaining({
        jobId: expect.stringMatching(/^interpret:1:r\d+$/),
        delay: 30 * 60_000,
      }),
    );
    expect(prismaMock.telegram.update).not.toHaveBeenCalled();
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("ASR 三连败 → 降级 missing_transcript,仍走 LLM 落 ai_* 列", async () => {
    transcribeMock.mockRejectedValue(new Error("ASR 限流"));
    stubDownload();
    vi.useFakeTimers();
    const pending = interpretVideoJob(DATA);
    await vi.advanceTimersByTimeAsync(10_000); // 2 次 3s 重试间隔
    const outcome = await pending;
    expect(outcome).toMatchObject({ status: "missing_transcript", transcriptUsed: false });
    expect(transcribeMock).toHaveBeenCalledTimes(3);
    expect(chatJsonMock).toHaveBeenCalledTimes(1);
    expect(chatJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.not.stringContaining("视频转写全文") }),
    );
    expect(prismaMock.telegram.update).toHaveBeenLastCalledWith({
      where: { id: BigInt(1) },
      data: expect.objectContaining({ aiStatus: "missing_transcript", lastAiError: "ASR 限流" }),
    });
  });

  it("LLM 网络错误 → 标 failed 后上抛(attempts 兜重试)", async () => {
    chatJsonMock.mockRejectedValue(new Error("boom"));
    stubDownload();
    await expect(interpretVideoJob(DATA)).rejects.toThrow("boom");
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { aiStatus: "failed", lastAiError: "boom" },
    });
  });

  it("LLM 输出不成 JSON(含一次解析重试)→ failed 返回,不烧 attempts", async () => {
    chatJsonMock.mockResolvedValue("不是 JSON 的回答");
    stubDownload();
    const outcome = await interpretVideoJob(DATA);
    expect(outcome).toMatchObject({ status: "failed", transcriptUsed: false });
    expect(chatJsonMock).toHaveBeenCalledTimes(2); // 解析重试恰一次
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { aiStatus: "failed", lastAiError: expect.stringContaining("LLM 输出无法解析") },
    });
  });

  it("无直链且无匹配锚(videoId/secUid 缺)→ failed 不触网", async () => {
    const calls = stubDownload();
    const outcome = await interpretVideoJob({
      ...DATA,
      playUrl: null,
      videoId: null,
      secUid: null,
    });
    expect(outcome.status).toBe("failed");
    expect(calls).toHaveLength(0);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("过境直链缺失 → 网关重拉 listing(maxPages=3)按 videoId 命中", async () => {
    stubDownload();
    fetchVideosMock.mockResolvedValue([
      { videoId: "vid-9", playUrl: "https://fresh/x" },
      { videoId: "vid-1", playUrl: "https://fresh/1" },
    ]);
    const outcome = await interpretVideoJob({ ...DATA, playUrl: null });
    expect(outcome.status).toBe("done");
    expect(fetchVideosMock).toHaveBeenCalledWith({
      secUid: "sec-abc",
      cookies: ["ck"],
      maxPages: 3,
    });
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      "/tmp/interpret-fake/video.mp4",
      expect.any(Buffer),
    );
  });

  it("过境直链过期(下载失败)→ 重拉一次新链再试", async () => {
    stubDownload("fail-first");
    fetchVideosMock.mockResolvedValue([{ videoId: "vid-1", playUrl: "https://fresh/1" }]);
    const outcome = await interpretVideoJob(DATA);
    expect(outcome.status).toBe("done");
    expect(fetchVideosMock).toHaveBeenCalledTimes(1);
  });

  it("下载持续失败 → 标 failed 后上抛(BullMQ attempts 兜)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    fetchVideosMock.mockResolvedValue([{ videoId: "vid-1", playUrl: "https://fresh/1" }]);
    await expect(interpretVideoJob(DATA)).rejects.toThrow("fetch failed");
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { aiStatus: "failed", lastAiError: "fetch failed" },
    });
  });
});
