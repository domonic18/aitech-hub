# 写作技能库（真相源）

站内 agent 的 7 份写作指南已导出到这里，成为**唯一真相源**（站内 `agent_skill` 表与 `src/lib/ai/writing-guides.ts` 常量将在瘦身后续批次下线）。

- **消费者**：线下 Claude Code 写作助手（直接 Read 本目录文件）。MCP 侧另有只读兜底通道（`list_skills` / `get_skill`），读的是**部署镜像内的副本，可能滞后于本地 checkout** —— 以本目录为准。
- **迭代**：改指南 = 改本目录的 markdown = commit 即可，**不需要构建镜像、不需要发版**（这是本次瘦身要解决的核心问题：原先改指南要重跑 seed 落库 + 发版）。

## 一览

| key | 名称 | 适用场景 |
| --- | --- | --- |
| `blogger-video` | 博主×视频推荐短文 | 公众号「博主×视频」推荐短文（专题合成默认场景） |
| `card-rendering` | 图文卡片渲染 | 文章/公众号富排版配图：金句、要点、数据指标、对比、步骤卡 |
| `open-source-intro` | 开源项目介绍 | 公众号「开源项目介绍」稿：痛点-机制-上手路径结构 |
| `paper-interpret` | 论文解读 | 公众号「论文解读」稿：问题-直觉-实验-边界结构 |
| `tutorial-refine` | 教程精炼 | 公众号「教程精炼」稿：准备-步骤-坑-验收手册 |
| `weekly-news` | 周新闻精选 | 公众号「周新闻精选」稿：速览+分组综述 |
| `model-pricing` | 模型价格表 | 公众号「模型价格表」稿：表格主干速查 |

绑定关系：`src/lib/topics/constants.ts` 的 `TOPIC_PURPOSES[].skillKey`（创作类型 → 指南）。守卫单测见 `src/lib/ai/writing-skills-files.test.ts`。

## 给线下写作助手的安装方式

本目录是**受版本控制的真相源**，线下 Claude Code 有两种用法：

1. **直接读（推荐）**：线下 Claude Code 在本仓库的工作副本里干活时，按场景 Read `skills/writing/<key>.md` 即可 —— 改指南 commit 即生效，无须安装。
2. **拷贝到自己的 skills 目录**：把整个 `skills/writing/` 拷到线下助手的 skills 目录下，再加一个索引型 skill（`SKILL.md`，frontmatter 含 `name` / `description`）指向它：SKILL.md 里列「场景 → key」对照并说明「动笔前先 Read 对应那份」，工作流段落见本文件下方。

> 注意：本仓 `.claude/` 在 .gitignore 内，`.claude/skills/writing-assistant/` 只是**本机工作副本**（在本仓干活时自动可用），不入库 —— 入库的是本目录。

## 维护约定

1. **公共条款已内联**：原先由 `CRAFT_ILLUSTRATION_PLAN` 插值进 6 份指南的公共段落（配图工艺），导出时**直接内联进各文件** —— 每份文件自包含，线下读一份就够，不必跨文件拼。代价：改公共条款要同步 7 处。
2. **纪律条款不要改写**：本目录的条款与站内原版逐字一致，只有「工具指向」按线下语境改写过。改条款前先确认是内容变更还是工具变更。
3. **工具指向的现状**（截至 2026-11-14）：

   | 站内原工具 | 线下口径 |
   | --- | --- |
   | `render_card` | 站内 `POST /api/cards/render`（**尚未上线**）；暂以本地出图 + `POST /api/media/` 上传替代 |
   | `generate_illustration` | 本地生成配图 → `POST /api/media/` 上传（线上不生图，图字节不过模型上下文） |
   | `save_topic_draft` | MCP `upsert_article`（恒落草稿） |
   | `measure_wechat_budget` | 按指南给定的码点口径自行自查（纯文本 ≤2500 码点、全文 ≤4000 码点） |
   | `get_skill` | 直接 Read 本目录对应 `.md` |
   | `generate_cover_candidates` | 站内 `POST /api/posts/cover-candidates`（D3 裁定：AI 封面留在站内，改 HTTP 触发） |

4. **已知缺口**：卡图清单（站内 `save_topic_draft` 的 `card_urls`，落库时校验「每张信息卡都已嵌入正文」，漏嵌拒稿）—— MCP `upsert_article` **暂无该字段**（瘦身方案 B1 待补）。在补上之前，线下须自行核对每张信息卡都已嵌入正文。
