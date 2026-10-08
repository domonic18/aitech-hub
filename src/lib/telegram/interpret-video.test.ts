/**
 * 视频解读管道单测:prisma/queue/AI 客户端/ffmpeg/fs 全打桩,验状态机分支——
 * 幂等 skip、未配置不标败、配额顺延重投、ASR 停用/直链缺失降级文案概括(M12 解耦)、
 * ASR 三连败降级仍走 LLM、LLM 解析败 failed 不烧 attempts、
 * 直链两路获取与过期回拉、临时文件即删。
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
vi.mock("../queue", () => ({
  QUEUE_CRAWLER: "crawler",
  QUEUE_INTERPRETER: "interpreter",
  getQueue: () => queueMock,
}));

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

vi.mock("./cookies", () => ({ jarsFromConfig: vi.fn(() => ["ck"]) }));

const fetchVideosMock = vi.hoisted(() =>
  vi.fn<(args: unknown) => Promise<Array<{ videoId: string; playUrl: string | null }>>>(
    async () => [],
  ),
);
vi.mock("./adapters/video/douyin", () => ({
  douyinAdapter: { fetchRecentVideos: fetchVideosMock },
}));

// 媒体操作整桩(下载走全局 fetch 桩保留「直链过期重拉」语义;即删/抽轨记录调用)。
// 真实现的下载护栏/ffmpeg 参数由 lib/media 侧职责,不进本测试面。
const mediaMock = vi.hoisted(() => ({
  makeInterpretTmpDir: vi.fn(async () => "/tmp/interpret-fake"),
  tmpMediaPaths: vi.fn((dir: string) => ({
    videoPath: `${dir}/video.mp4`,
    audioPath: `${dir}/audio.mp3`,
  })),
  removeTmpDir: vi.fn(async () => undefined),
  downloadVideoToTmp: vi.fn(async (playUrl: string, destPath: string) => {
    const res = await fetch(playUrl);
    if (!res.ok) throw new Error(`直链下载失败 HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mediaMock.writeCalls.push([destPath, buf]);
  }),
  extractAudioMp3: vi.fn(async () => undefined),
  readAudioFile: vi.fn(async () => Buffer.from("audio-bytes")),
  writeCalls: [] as Array<[string, Buffer]>,
}));
vi.mock("../media/interpret-media", () => mediaMock);

import {
  interpretJobId,
  interpretVideoJob,
  markPendingAndEnqueue,
  type InterpretJobData,
} from "./interpret-video";

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
  mediaMock.writeCalls.length = 0;
  mediaMock.removeTmpDir.mockResolvedValue(undefined);
  mediaMock.readAudioFile.mockResolvedValue(Buffer.from("audio-bytes"));
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
    expect(mediaMock.removeTmpDir).toHaveBeenCalledWith("/tmp/interpret-fake");
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
      expect.any(Function),
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

  it("ASR 停用 → 降级文案概括(M12 解耦):不触下载/转写,missing_transcript 落 ai_* 列", async () => {
    prismaMock.asrConfig.findUnique.mockResolvedValue({ ...ASR_ROW, enabled: false });
    const outcome = await interpretVideoJob(DATA);
    expect(outcome).toMatchObject({ status: "missing_transcript", transcriptUsed: false });
    expect(mediaMock.makeInterpretTmpDir).not.toHaveBeenCalled();
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(chatJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.not.stringContaining("视频转写全文") }),
      expect.any(Function),
    );
    expect(prismaMock.telegram.update).toHaveBeenLastCalledWith({
      where: { id: BigInt(1) },
      data: expect.objectContaining({ aiStatus: "missing_transcript", lastAiError: null }),
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
        jobId: expect.stringMatching(/^interpret-1-r\d+$/),
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
      expect.any(Function),
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

  it("无直链且无匹配锚(videoId/secUid 缺)→ 降级文案概括,不触下载(M12 起不再 failed)", async () => {
    const calls = stubDownload();
    const outcome = await interpretVideoJob({
      ...DATA,
      playUrl: null,
      videoId: null,
      secUid: null,
    });
    expect(outcome).toMatchObject({ status: "missing_transcript", transcriptUsed: false });
    expect(calls).toHaveLength(0);
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(prismaMock.telegram.update).toHaveBeenLastCalledWith({
      where: { id: BigInt(1) },
      data: expect.objectContaining({
        aiStatus: "missing_transcript",
        lastAiError: expect.stringContaining("无可用播放直链"),
      }),
    });
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
    expect(mediaMock.writeCalls).toEqual([["/tmp/interpret-fake/video.mp4", expect.any(Buffer)]]);
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

describe("markPendingAndEnqueue 入队契约(pending→入队→回滚 单一入口)", () => {
  const PAYLOAD = { videoId: "vid-1", playUrl: null, platform: "douyin", secUid: "sec-abc" };

  it("先标 pending(lastAiError 重置)再入队,顺序不可反", async () => {
    const order: string[] = [];
    prismaMock.telegram.update.mockImplementation(async () => {
      order.push("update");
      return {};
    });
    queueMock.add.mockImplementation(async () => {
      order.push("add");
      return undefined;
    });
    await markPendingAndEnqueue(BigInt(9), PAYLOAD);
    expect(order).toEqual(["update", "add"]);
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(9) },
      data: { aiStatus: "pending", lastAiError: null },
    });
    expect(queueMock.add).toHaveBeenCalledWith(
      "interpret-video",
      { telegramId: "9", ...PAYLOAD },
      expect.objectContaining({ jobId: "interpret-9", removeOnComplete: 50 }),
    );
  });

  it("interpretJobId 幂等锚与顺延后缀(连字符分隔,BullMQ 禁冒号)", () => {
    expect(interpretJobId("5")).toBe("interpret-5");
    expect(interpretJobId("5", "r123")).toBe("interpret-5-r123");
  });

  it("入队失败 → 回滚 aiStatus=null(吞更新错)后原样上抛", async () => {
    queueMock.add.mockRejectedValue(new Error("redis down"));
    await expect(markPendingAndEnqueue(BigInt(9), PAYLOAD)).rejects.toThrow("redis down");
    expect(prismaMock.telegram.update).toHaveBeenLastCalledWith({
      where: { id: BigInt(9) },
      data: { aiStatus: null },
    });
  });
});
