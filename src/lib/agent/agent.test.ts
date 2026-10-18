/**
 * agent 图装配纯函数单测(工具面/系统提示按身份档分发,M27 批④建、批⑤随
 * agent 自主生产重构更新;M30 批② 随技能化更新——写作指南提取为 agent_skill
 * 资产,提示改「技能调度」条款):guest/user 维持 K2.5 只读六件与基线提示;
 * admin 追加专题生产四件、编辑域两件与技能两件工具。重 IO 装配
 * (getAgentGraph/checkpointer/模型解析)不入单测,由真机验收。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./tools", () => ({
  AGENT_TOOLS: [
    { name: "search_site" },
    { name: "read_post" },
    { name: "read_repo" },
    { name: "get_time" },
    { name: "ask_user" },
    { name: "submit_feedback" },
  ],
  EDIT_TOOLS: [{ name: "read_draft" }, { name: "propose_edits" }],
}));
vi.mock("./topic-tools", () => ({
  TOPIC_TOOLS: [
    { name: "get_topic_brief" },
    { name: "transfer_video_cover" },
    { name: "generate_cover_candidates" },
    { name: "save_topic_draft" },
  ],
}));
vi.mock("./write-article-tool", () => ({
  WRITE_ARTICLE_TOOLS: [{ name: "write_article" }],
}));
vi.mock("./post-sources-tool", () => ({
  POST_SOURCES_TOOLS: [{ name: "get_post_sources" }],
}));
vi.mock("./skill-tools", () => ({
  SKILL_TOOLS: [{ name: "list_skills" }, { name: "get_skill" }],
}));
vi.mock("./wechat-budget-tool", () => ({
  WECHAT_BUDGET_TOOLS: [{ name: "measure_wechat_budget" }],
}));
vi.mock("./checkpointer", () => ({
  ensureAgentCheckpointer: vi.fn(),
  getAgentCheckpointer: vi.fn(),
}));
vi.mock("./model-factory", () => ({ resolveAgentModel: vi.fn() }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { AGENT_SYSTEM_PROMPT, agentSystemPrompt, agentToolsFor } from "./agent";

describe("agentToolsFor(工具面按身份分发)", () => {
  it("guest/user 只读六件,无专题生产工具", () => {
    for (const kind of ["guest", "user"] as const) {
      expect(agentToolsFor(kind).map((t) => t.name)).toEqual([
        "search_site",
        "read_post",
        "read_repo",
        "get_time",
        "ask_user",
        "submit_feedback",
      ]);
    }
  });

  it("admin 追加编辑域(read_draft/propose_edits)、专题生产四件+素材反查、写作单任务、封面 HITL、技能两件、预算与卡片工具", () => {
    expect(agentToolsFor("admin").map((t) => t.name)).toEqual([
      "search_site",
      "read_post",
      "read_repo",
      "get_time",
      "ask_user",
      "submit_feedback",
      "read_draft",
      "propose_edits",
      "get_topic_brief",
      "transfer_video_cover",
      "generate_cover_candidates",
      "save_topic_draft",
      "get_post_sources",
      "write_article",
      "generate_post_cover",
      "list_skills",
      "get_skill",
      "measure_wechat_budget",
      "render_card",
    ]);
  });
});

describe("agentSystemPrompt(提示按身份分发)", () => {
  it("guest/user 即基线提示,不含专题生产与编辑域语义", () => {
    for (const kind of ["guest", "user"] as const) {
      expect(agentSystemPrompt(kind)).toBe(AGENT_SYSTEM_PROMPT);
      expect(agentSystemPrompt(kind)).not.toContain("save_topic_draft");
      expect(agentSystemPrompt(kind)).not.toContain("read_draft");
      expect(agentSystemPrompt(kind)).not.toContain("propose_edits");
    }
  });

  it("admin 基线之上追加工作流段(write_todos 计划先行 + 选题 ask_user + 落库确认回路)", () => {
    const p = agentSystemPrompt("admin");
    expect(p.startsWith(AGENT_SYSTEM_PROMPT)).toBe(true);
    expect(p).toContain("save_topic_draft");
    expect(p).toContain("write_todos");
    expect(p).toContain("ask_user");
    expect(p).toContain("needConfirm");
  });

  it("写作单任务捆绑(2026-10-17):第 3 步 write_article 独立模型起草,初稿后自评审嵌卡再落库", () => {
    const p = agentSystemPrompt("admin");
    expect(p).toContain("write_article");
    expect(p).toContain("独立模型");
    expect(p).toContain("draft_md");
    // skill_key 传工具侧自动装载指南,不由编排模型转述指南全文
    expect(p).toContain("工具侧自动装载指南");
    // 正文交付纪律不变:终稿只经 content_md 交付
    expect(p).toContain("严禁把正文整篇输出到对话流");
  });

  it("配图链提示(批⑥):cover_path 直引 + 生图插图 + transfer 重试 + 卡图不重复", () => {
    const p = agentSystemPrompt("admin");
    // 分配面:brief 已转存站内路径,正文直引;严禁编造外链
    expect(p).toContain("素材的 cover_path");
    expect(p).toContain("严禁编造外链图片");
    // 生图放开到正文概念示意图;transfer_video_cover 定位为重试/补传钮
    expect(p).toContain("概念示意图");
    expect(p).toContain("transfer_video_cover 重试");
    // 消费口径:头图避让文首卡同图(卡自动带图属系统行为,留在工作流段;
    // 张数引导属 skill 风格,已迁种子指南)
    expect(p).toContain("文首推荐卡由系统自动带图");
    expect(p).toContain("正文开头不要再贴同一张");
  });

  it("卡片可视化纪律(2026-10-17 反馈):render_card 唯一实现 + 合成卡闸门 + 改稿出卡", () => {
    const p = agentSystemPrompt("admin");
    // 唯一实现:render_card PNG + ![](url);内联 HTML 卡是 M36 已退役旧形态
    expect(p).toContain("卡片可视化纪律");
    expect(p).toContain("唯一正确实现");
    expect(p).toContain("内联样式 HTML");
    expect(p).toContain("已退役");
    // 可视化优先原则(批⑤修订):不硬编码张数/卡型路由,策略归指南
    expect(p).toContain("替代大段纯文字表述");
    expect(p).toContain("能综合为一张卡呈现就一张");
    expect(p).toContain("以技能指南为准");
    expect(p).not.toContain("全景→flow"); // 卡型路由表已撤出提示词(L2 归指南)
    expect(p).not.toContain("每篇 3~5 张");
    // 合成闸门:内容级硬闸(card_urls 漏嵌被拒);编辑上下文改稿 = 出卡替换
    expect(p).toContain("card_urls");
    expect(p).toContain("漏嵌会被工具拒绝");
    expect(p).toContain("以卡图替换对应文字段");
    // 渲染了但没嵌 = 白做(2026-10-17 第二轮反馈)
    expect(p).toContain("markdown_line");
    expect(p).toContain("渲染了卡但正文没嵌");
  });

  it("技能调度提示(M30 批②):写前必取 skill + skill_key 直取 + 无命中说明 + 自评审闭环仍在", () => {
    const p = agentSystemPrompt("admin");
    // 渐进披露调度:动笔前先 list_skills,绑定/命中即 get_skill 取全文
    expect(p).toContain("list_skills");
    expect(p).toContain("get_skill");
    expect(p).toContain("topic.skill_key");
    expect(p).toContain("技能调度");
    // 降级路径与指南优先级;具体风格纪律(钩子/反套话/字数)已迁种子 skill
    expect(p).toContain("清单为空或无命中");
    expect(p).toContain("未命中适用技能");
    expect(p).toContain("优先于本提示的通用写法");
    // 自评审闭环:save 前必做的逐项检查步;轮数封顶 2,防无限重写
    expect(p).toContain("自评审并优化");
    expect(p).toContain("不可跳过");
    expect(p).toContain("至多 2 轮");
    expect(p).toContain("禁止反复重写");
  });

  it("文章编辑上下文提示(批⑧-b):[页面上下文] edit 段指代 → read_draft 读现稿,不猜内容", () => {
    const p = agentSystemPrompt("admin");
    expect(p).toContain("[页面上下文]");
    expect(p).toContain("edit.postId");
    expect(p).toContain("read_draft");
    expect(p).toContain("不要凭空猜测内容");
  });

  it("改稿纪律提示(批⑧-c):提案不落笔 + S/R 档默认 + resume 回路 + 严禁抢先宣称完成", () => {
    const p = agentSystemPrompt("admin");
    expect(p).toContain("提案不落笔");
    expect(p).toContain("逐字符复制");
    expect(p).toContain("propose_edits");
    // resume 决策四态与迭代上限
    expect(p).toContain("applied");
    expect(p).toContain("partial");
    expect(p).toContain("rejected");
    expect(p).toContain("unavailable");
    expect(p).toContain("至多连续两轮");
    // 语义红线:接受前不得宣称已改完
    expect(p).toContain("严禁在提案被接受前声称");
  });
});
