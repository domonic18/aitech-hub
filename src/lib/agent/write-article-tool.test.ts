/**
 * write_article 单测(2026-10-17 撰写文章单任务捆绑):admin 纵深防线 /
 * 无素材拒 / 写作模型未绑定人话 / extraParams.max_tokens 未配置 fail-closed
 * (零 hardcode:不静默按小预算截断)/ happy path 底料装配(指南全文 +
 * angle/outline)与台账 role=writing / 封面不进底料不转存(2026-10-17 呈现
 * 协调性反馈)/ skill_key 缺省回专题绑定 / chatText 业务失败人话 / prompt
 * 纯函数机制断言。DB/LLM 全 mock。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionOk = vi.hoisted(() => vi.fn());
const adminThreadDeny = vi.hoisted(() =>
  vi.fn(() => JSON.stringify({ ok: false, error: "denied" })),
);
vi.mock("./admin-thread", () => ({
  assertAdminThread: sessionOk,
  adminThreadDeny,
}));

const getTopic = vi.hoisted(() => vi.fn());
vi.mock("../topics/repo", () => ({
  getTopic,
  TopicError: class extends Error {
    constructor(_code: string, message: string) {
      super(message);
    }
  },
}));

const buildComposeBlocks = vi.hoisted(() => vi.fn());
const listRecentPublishedTitles = vi.hoisted(() => vi.fn());
const transferVideoCovers = vi.hoisted(() => vi.fn());
vi.mock("../topics/compose", () => ({
  buildComposeBlocks,
  listRecentPublishedTitles,
  transferVideoCovers,
}));

const getEnabledSkillByKey = vi.hoisted(() => vi.fn());
vi.mock("../ai/agent-skills-admin", () => ({ getEnabledSkillByKey }));

const resolveAiModel = vi.hoisted(() => vi.fn());
vi.mock("../ai/resolver", () => ({ resolveAiModel }));

const chatText = vi.hoisted(() => vi.fn());
vi.mock("../ai/llm-client", () => ({ chatText }));

const recordAiUsage = vi.hoisted(() => vi.fn());
vi.mock("../ai/usage-log", () => ({ recordAiUsage }));

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { AiClientError } from "../ai/errors";
import { TopicError } from "../topics/repo";
import { buildWriterPrompt, writeArticleTool } from "./write-article-tool";

/** 工具调用统一入口(topic-tools.test 同手法) */
async function invoke(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const raw = (await writeArticleTool.invoke(
    args as never,
    {
      configurable: { thread_id: "t-admin" },
    } as never,
  )) as string;
  return JSON.parse(raw) as Record<string, unknown>;
}

const TOPIC = {
  id: BigInt(7),
  title: "端侧拐点",
  positioning: "面向开发者",
  skillKey: "blogger-video",
  linkedPostId: null,
  items: [{}],
};

const BLOCK = {
  kind: "telegram",
  mediaType: "video",
  title: "视频A",
  blogger: "UP主A",
  note: "突出成本",
  videoUrl: "https://b23.tv/x",
  summary: "原文一句",
  aiTopic: "端侧",
  keywords: ["端侧", "推理"],
  coverUrl: "https://img/x.jpg",
  aiNote: "解读笔记全文",
  aiSummary: null,
  aiPoints: [],
  excerpt: null,
  contentSample: null,
};

const WRITER_MODEL = {
  id: 9,
  name: "写手",
  protocol: "openai",
  baseUrl: "https://llm.test/v1",
  modelId: "writer-x",
  apiKey: "sk-w",
  timeoutSec: 120,
  concurrency: 1,
  supportsVision: false,
  extraParams: { max_tokens: 131_072 },
  source: "primary" as const,
};

beforeEach(() => {
  sessionOk.mockReset().mockResolvedValue(true);
  getTopic.mockReset();
  buildComposeBlocks.mockReset();
  listRecentPublishedTitles.mockReset().mockResolvedValue([]);
  transferVideoCovers.mockReset().mockResolvedValue([]);
  getEnabledSkillByKey.mockReset();
  resolveAiModel.mockReset();
  chatText.mockReset().mockResolvedValue("# 草稿");
  recordAiUsage.mockReset();
});

describe("write_article", () => {
  it("非 admin 会话 → 拒且不触达业务", async () => {
    sessionOk.mockResolvedValueOnce(false);
    await expect(invoke({ topic_id: "7", angle: "a", outline: "o" })).resolves.toMatchObject({
      error: "denied",
    });
    expect(getTopic).not.toHaveBeenCalled();
  });

  it("专题无素材 → ok:false 人话", async () => {
    getTopic.mockResolvedValueOnce(TOPIC);
    buildComposeBlocks.mockResolvedValueOnce([]);
    await expect(invoke({ topic_id: "7", angle: "a", outline: "o" })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("素材"),
    });
  });

  it("写作模型未绑定 → ok:false 人话指路任务绑定", async () => {
    getTopic.mockResolvedValueOnce(TOPIC);
    buildComposeBlocks.mockResolvedValueOnce([BLOCK]);
    resolveAiModel.mockResolvedValueOnce(null);
    await expect(invoke({ topic_id: "7", angle: "a", outline: "o" })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("文章写作"),
    });
  });

  it("extraParams 未配 max_tokens → fail-closed 人话(不静默按小预算截断)", async () => {
    getTopic.mockResolvedValueOnce(TOPIC);
    buildComposeBlocks.mockResolvedValueOnce([BLOCK]);
    resolveAiModel.mockResolvedValueOnce({ ...WRITER_MODEL, extraParams: {} });
    const out = await invoke({ topic_id: "7", angle: "a", outline: "o" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("extraParams");
    expect(chatText).not.toHaveBeenCalled();
  });

  it("happy path:底料装配(指南/角度/提纲)+ 预算透传 + 台账 writing + 封面不进底料", async () => {
    getTopic.mockResolvedValueOnce(TOPIC);
    buildComposeBlocks.mockResolvedValueOnce([BLOCK]);
    getEnabledSkillByKey.mockResolvedValueOnce({
      key: "blogger-video",
      guideMd: "指南全文……",
    });
    resolveAiModel.mockResolvedValueOnce(WRITER_MODEL);
    chatText.mockResolvedValueOnce("# 端侧拐点\n\n正文");
    const out = await invoke({
      topic_id: "7",
      angle: "成本拐点已到",
      outline: "开头\n成本对比\n展望",
      guidance: "多用素材数据",
    });
    expect(out).toMatchObject({
      ok: true,
      draft_md: "# 端侧拐点\n\n正文",
      chars: "# 端侧拐点\n\n正文".length,
      model: "writer-x",
      skill_loaded: "blogger-video",
    });
    const call = chatText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.maxTokens).toBe(131_072); // 只从台账来
    expect(call.modelId).toBe("writer-x");
    expect(call.system).toContain("指南全文……");
    expect(call.user).toContain("成本拐点已到");
    expect(call.user).toContain("开头");
    expect(call.user).toContain("解读笔记全文");
    expect(call.user).toContain("https://b23.tv/x");
    // 封面纪律(2026-10-17 呈现协调性):不转存、不进底料——推荐卡由系统注入
    expect(transferVideoCovers).not.toHaveBeenCalled();
    expect(call.user).not.toContain("/wp/a.jpg");
    expect(call.system).toContain("不插入任何图片");
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ role: "writing", modelId: 9, status: "ok" }),
    );
  });

  it("output_config 从台账 extraParams 透传写作模型(Kimi effort);未配则不带", async () => {
    getTopic.mockResolvedValueOnce(TOPIC);
    buildComposeBlocks.mockResolvedValueOnce([BLOCK]);
    getEnabledSkillByKey.mockResolvedValueOnce(null);
    resolveAiModel.mockResolvedValueOnce({
      ...WRITER_MODEL,
      protocol: "anthropic",
      extraParams: { max_tokens: 65_536, output_config: { effort: "low" } },
    });
    await invoke({ topic_id: "7", angle: "a", outline: "o" });
    expect(chatText.mock.calls[0]?.[0]).toMatchObject({ outputConfig: { effort: "low" } });

    getTopic.mockResolvedValueOnce(TOPIC);
    buildComposeBlocks.mockResolvedValueOnce([BLOCK]);
    getEnabledSkillByKey.mockResolvedValueOnce(null);
    resolveAiModel.mockResolvedValueOnce(WRITER_MODEL);
    await invoke({ topic_id: "7", angle: "a", outline: "o" });
    expect(chatText.mock.calls[1]?.[0]).toMatchObject({ outputConfig: undefined });
  });

  it("skill_key 省略回专题绑定;指南停用 → skill_loaded null 仍写作", async () => {
    getTopic.mockResolvedValueOnce(TOPIC);
    buildComposeBlocks.mockResolvedValueOnce([BLOCK]);
    getEnabledSkillByKey.mockResolvedValueOnce(null);
    resolveAiModel.mockResolvedValueOnce(WRITER_MODEL);
    const out = await invoke({ topic_id: "7", angle: "a", outline: "o" });
    expect(out.skill_loaded).toBeNull();
    expect(getEnabledSkillByKey).toHaveBeenCalledWith("blogger-video");
    expect(out.ok).toBe(true);
  });

  it("skill_key 入参优先于专题绑定", async () => {
    getTopic.mockResolvedValueOnce(TOPIC);
    buildComposeBlocks.mockResolvedValueOnce([BLOCK]);
    getEnabledSkillByKey.mockResolvedValueOnce({ key: "other", guideMd: "g" });
    resolveAiModel.mockResolvedValueOnce(WRITER_MODEL);
    await invoke({ topic_id: "7", angle: "a", outline: "o", skill_key: "other" });
    expect(getEnabledSkillByKey).toHaveBeenCalledWith("other");
  });

  it("chatText 业务失败 → ok:false 人话可重试", async () => {
    getTopic.mockResolvedValueOnce(TOPIC);
    buildComposeBlocks.mockResolvedValueOnce([BLOCK]);
    resolveAiModel.mockResolvedValueOnce(WRITER_MODEL);
    chatText.mockRejectedValueOnce(new AiClientError("http", "HTTP 429: rate limited"));
    const out = await invoke({ topic_id: "7", angle: "a", outline: "o" });
    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining("HTTP 429"),
    });
  });

  it("专题不存在(TopicError)→ 人话", async () => {
    getTopic.mockRejectedValueOnce(new TopicError("not_found", "专题不存在"));
    await expect(invoke({ topic_id: "7", angle: "a", outline: "o" })).resolves.toMatchObject({
      ok: false,
      error: "专题不存在",
    });
  });
});

describe("buildWriterPrompt(纯函数)", () => {
  it("有指南:机制输出纪律在 system,指南全文随附;无指南:常识写作降级提示", () => {
    const base = {
      topicTitle: "端侧拐点",
      positioning: null,
      angle: "a",
      outline: "o",
      guidance: null,
      recentTitles: ["旧文一"],
      materials: [],
    };
    const withGuide = buildWriterPrompt({ ...base, skillGuideMd: "指南G" });
    expect(withGuide.system).toContain("指南G");
    expect(withGuide.system).toContain("只输出正文 markdown 全文");
    const noGuide = buildWriterPrompt({ ...base, skillGuideMd: null });
    expect(noGuide.system).toContain("无适用指南");
    expect(noGuide.user).toContain("旧文一");
  });

  it("素材渲染:批注/要点/摘录/视频地址逐项进底料;封面路径无字段可渲染", () => {
    const { user } = buildWriterPrompt({
      topicTitle: "t",
      positioning: "p",
      angle: "a",
      outline: "o",
      guidance: null,
      skillGuideMd: null,
      recentTitles: [],
      materials: [
        {
          kind: "telegram",
          mediaType: "video",
          title: "视频A",
          blogger: "UP主A",
          note: "批注N",
          videoUrl: "https://b23.tv/x",
          summary: null,
          aiTopic: null,
          keywords: [],
          aiNote: null,
          aiSummary: "摘要S",
          aiPoints: ["p1", "p2"],
          excerpt: null,
          contentSample: null,
        },
      ],
    });
    expect(user).toContain("视频A");
    expect(user).toContain("UP主A");
    expect(user).toContain("批注N");
    expect(user).toContain("https://b23.tv/x");
    expect(user).toContain("p1;p2");
    expect(user).not.toContain("/wp/a.jpg");
  });
});
