# 功能开发计划

> 需求基准:[requirement/01-requirement.md](../requirement/01-requirement.md);架构与实现方案见 [docs/arch/](../arch/)。
> 本文档只维护里程碑级计划与完成状态;实现细节、调研与实施过程沉淀在 arch 文档与代码提交历史中,不在此回填。

## 1. 当前基线

项目处于方案定稿阶段(2026-09-29):**Next.js 15 全栈单体**技术选型与文档体系已定,代码未开始。数据摸底结论冻结于 [03-WordPress数据迁移设计.md](../arch/03-WordPress数据迁移设计.md) §1。

## 2. 里程碑(一期)

| 里程碑 | 主题 | 内容概要 | 验收标准 | 状态 |
|--------|------|----------|----------|------|
| M1 | 骨架与基建 | 目录落盘(01 文档 §1 全树);根 CLAUDE.md;Makefile、.env.example(Zod env)、husky+lint-staged、compose(dev: pg5434/redis6380)、prisma/schema.prisma + 0000_init + seed.ts、GitHub Actions ci.yml(app 门禁 + 迁移重放守卫)、Dockerfile(web/worker 双角色)、README | `make check` 全绿;迁移重放守卫 CI 过;`make setup` 后空库可起、/api/health 通 | 未实现 |
| M2 | 迁移脚本 | scripts/migrate-wp/(extract/transform/clean-html/media-manifest/load/verify/run,dry-run;TS,复用 src/lib/slug 与清洗规则);以本地 wp_mysql 为源全流程实跑;media 引用闭包落地 media/ + content_media_ref | verify 七条全 PASS(本地口径);migration_report 无未确认警告 | 未实现 |
| M3 | 前台 | 布局/首页/文章详情(中文 slug)/列表/分类/标签/归档/搜索/关于/协议页;ISR + 保存时 revalidate;sitemap/robots/feed/JSON-LD;**llms.txt + 文章 md 直出(GEO,战略定稿必做)**;legacy 兜底路由 + legacy_url_map 301;ArticleBody 双模式渲染;**站点统计采集(2026-09-29 需求补充)**:全站 beacon 上报 API + 去 bot/去管理员 + IP+UA 哈希 UV + 日聚合落库,文章 PV 与站点统计同源 | 06 文档 E2E 前四条过;/llms.txt 与任一文章 .md 直出可访问;PSI 移动端 LCP<2.5s;上报接口可用且日聚合落库可见 | 未实现 |
| M4 | 认证与用户中心 | sms-code/login/logout/session + 频控;jose Cookie 会话 + Redis 吊销;user_account 全量数据(M2 已迁);登录页、账号设置(昵称/头像/补设密码);pending_binding 绑定流程 | 集成测试过;老用户(含 pending_binding)登录闭环;安全事件日志可见 | 未实现 |
| M5 | 管理后台与媒体库 | admin 布局守卫;文章 CRUD + 发布/下架(Markdown 编辑器);**一键发文**:md 导入图片批量上传/外链转存/自动替换、封面工作流(上传+多尺寸裁剪模板);**媒体库**:上传管线(BullMQ sharp)、图片/视频/文件 Tab、引用追踪、孤儿/断链/重复体检、存储统计;用户管理;**站点统计页(2026-09-29 需求补充)**:总览卡片(今日/昨日/近7日/近30日 PV・UV)、PV/UV 趋势图、流量来源(搜索引擎细分/直接/站外 Top/AI 助手类目)、热门页面(时间段筛选)、访客环境分布;**发布 API + 创作 MCP(2026-09-29 需求补充)**:Bearer PAT 鉴权(PAT 哈希存储/可吊销/审计)的 upsert_article(slug 幂等)/upload_media/publish 等接口,图片随文自动上传替换与一键发文同管线;同应用托管 `/api/mcp` Streamable HTTP 端点暴露创作工具 | 后台发布新文章 → 前台即时可见;上传图片自动 WebP+缩略图;本地 md 连图一键导入替换;封面按模板一键多尺寸导出;孤儿扫描与批量删除可用;统计页各模块数据可见且与日聚合表一致;**Claude Code 经 MCP 从本地 md 连图发布草稿→直发闭环,同 slug 重发为更新,令牌吊销后即拒** | 未实现 |
| M6 | 上线切换 | 生产实跑迁移(以生产库为源);服务器部署(compose prod + nginx + ssl);备份/恢复演练;07 文档 §5 runbook 执行 + 验收清单;Search Console/百度站长重新提交 | 切换验收清单全勾;观察 1 周后下线 WP | 未实现 |

**发布门槛**:06 文档 §7 口径(验收全绿);M6 前必须完成备份恢复演练与全量 verify。

## 3. 二期后置池(满足触发条件再立项)

| 项 | 触发条件 | 技术预案 |
|----|----------|----------|
| GitHub 项目展示(domonic18 仓库同步 + README 渲染 + 进展动态) | 一期稳定运行;站点核心差异化方向,优先级最高。定位:AI 实践落地项目为主展示,工具类/模板类为后续建设方向,与「人机协同」内容线形成"文章教用法、仓库给武器"联动 | `github` 队列 + BullMQ 定时同步;`github_repo` 表增量迁移 |
| 付费阅读(虎皮椒;35448/38565 已购权益导入) | GitHub 展示交付后;先完成回调验签与对账设计 | `pay_order` 等表;`/api/pay/notify` 独立鉴权白名单 |
| 多渠道分发·微信公众号(纯 API) | 一期稳定后;开发者模式已就绪(2026-09-29 核实) | `distribute` 队列 + `publish_channel` 状态表;正文图 uploadimg 转存 + doocs/md 式内联样式 HTML + draft/add 推草稿;届时补 arch 文档。CSDN 等无 API 渠道后置,形态届时再定 |
| 封面 AI 文生图(腾讯云混元) | 与微信公众号分发并行或紧随其后 | 标题/摘要生成 prompt → 混元生图 → 多候选选用;与一期封面裁剪模板衔接 |
| 站点内容 MCP(对外只读;一期创作 MCP 已交付,见 requirement §3.6) | llms.txt/md 直出一期落地后,智能体引用形成一定规模 | 同一 `/api/mcp` 端点增加对外只读工具集,把"搜索文章/读文章"暴露为 MCP 工具;远期 RAG 问答入口(战略定位见 requirement §1) |
| AI 资讯管道(自建采集) | 有稳定内容运营节奏后 | Crawlee/BullMQ `crawler` 队列 + **复用 Python signer sidecar**([research/01-抖音采集与签名能力评估.md](../research/01-抖音采集与签名能力评估.md));届时补 arch 文档 |
| 图片迁 COS(URL 不变演进) | 流量包压力或磁盘吃紧 | `CosProvider` + Nginx 反代 origin(08 文档 §1) |
| 视频转码/封面自动化 | 自托管视频更新稳定 | COS 数据万象 snapshot;超规转码再评估 VOD |
| giscus 评论 | GitHub 展示上线后(依赖 Discussions) | - |
| 站内搜索升级 | PG 全文/LIKE 满足不了查询质量 | - |

## 4. 维护约定

- 状态标注:`未实现` → `实现中(分支)` → `已完成(日期 + PR)`;只在里程碑级维护,完成后归入 §1 基线一句话,过程不回填
- 范围变更:先改 requirement,再同步本文与相关 arch 文档,三者不一致以 requirement 为准
- E2E 与迁移对账的切换前全量执行结果,记录在 M6 行的完成备注中
