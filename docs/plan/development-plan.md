# 功能开发计划

> 需求基准:[requirement/01-requirement.md](../requirement/01-requirement.md);架构与实现方案见 [docs/arch/](../arch/)。
> 本文档只维护里程碑级计划与完成状态;实现细节、调研与实施过程沉淀在 arch 文档与代码提交历史中,不在此回填。

## 1. 当前基线

截至 2026-09-30:M1~M4 已完成(骨架基建 / WP 迁移脚本本地实跑七条全 PASS / 前台含 SEO·统计·llms.txt / admin 认证基座)。**同日需求评审四项定稿**:① 用户短信登录延后三期(运营商个人签名资质停发,requirement §3.3),一期仅 admin 密码鉴权;② 二期排序调整(GitHub 展示移电报流后、付费阅读收尾);③ Agent 搜索与站点内容 MCP 拆出二期,独立为「知识库 + Agent + MCP」专项(§4)。当前推进 M5(M5-a 合 PR #6;M5-b/M5-d 合 PR #7);开发主线 `develop`,`main` 发布线禁直推(standard/02-cicd-deployment §1.1)。数据摸底结论冻结于迁移脚本(scripts/migrate-wp)注释与 git 历史(原迁移设计文档已删,验收基准 requirement §7)。**2026-10-01 用户验收反馈**:编辑器体验与旧文只读不可编(四项),立项 M5-d 优先于 M5-c(编辑器可视化升级 + 旧文 md 批量接管);M5-b 交付的封面上传/截图直传被编辑器强依赖,M5-d 基于 M5-b 分支叠加。**2026-10-01 上线门槛评审**:一期不做注册(前台无用户体系,注册随三期短信登录,§3 复核);上线功能门槛定为 admin 登录、主页查看、文章发布/编辑;首页 Hub 布局壳前置立项 M5-e,M5-c(统计/发布 API/MCP)顺延为上线后首个线上迭代。

## 2. 里程碑(一期)

| 里程碑 | 主题 | 内容概要 | 验收标准 | 状态 |
|--------|------|----------|----------|------|
| M1 | 骨架与基建 | 目录落盘(arch/06-project-structure §1 全树);根 CLAUDE.md;Makefile、.env.example(Zod env)、husky+lint-staged、compose(dev: pg5434/redis6380)、prisma/schema.prisma + 0000_init + seed.ts、GitHub Actions ci.yml(app 门禁 + 迁移重放守卫)、Dockerfile(web/worker 双角色)、README | `make check` 全绿;迁移重放守卫 CI 过;`make setup` 后空库可起、/api/health 通 | 已完成(2026-09-29;本地 main 直提;基线含统计族与 user_pat 表,PK/FK 保留 Prisma 默认名见 arch/03-data-model §3) |
| M2 | 迁移脚本 | scripts/migrate-wp/(extract/transform/clean-html/media-manifest/load/verify/run,dry-run;TS,复用 src/lib/slug 与清洗规则);以本地 wp_mysql 为源全流程实跑;media 引用闭包落地 media/ + content_media_ref | verify 七条全 PASS(本地口径);migration_report 无未确认警告 | 已完成(2026-09-29;七条全 PASS,load 幂等;base64 图解码落盘、GitHuber MD 调查与浏览量 type 口径勘误沉淀于迁移脚本注释与 git 历史;verify 第 4 条 `--http` HTTP 实测已实装(2026-09-30,verify --http),M6 切换前以生产站全量对账;M3 的 E2E 冒烟已覆盖路由级抽样断言) |
| M3 | 前台 | 布局/首页/文章详情(中文 slug)/列表/分类/标签/归档/搜索/关于/协议页;ISR + 保存时 revalidate;sitemap/robots/feed/JSON-LD;**llms.txt + 文章 md 直出(GEO,战略定稿必做)**;legacy 兜底路由 + legacy_url_map 301;ArticleBody 双模式渲染;**站点统计采集(2026-09-29 需求补充)**:全站 beacon 上报 API + 去 bot/去管理员 + IP+UA 哈希 UV + 日聚合落库,文章 PV 与站点统计同源 | standard/01-testing E2E 前四条过;/llms.txt 与任一文章 .md 直出可访问;PSI 移动端 LCP<2.5s;上报接口可用且日聚合落库可见 | 已完成(2026-09-29;`e2e/` 冒烟原 4 过 1 skip,skip 的登录流用例已由 M4 实装为 admin 登录流,现全过;llms.txt/文章 .md/llms-full 分片直出与 beacon→flush 日聚合落库本地实测过;PSI 移动端 LCP 待线上环境实测,ISR+静态化已就位;实现差异沉淀于 arch/07-frontend 与 arch/05-services) |
| M4 | admin 认证基座 | **2026-09-30 收缩**:用户短信登录延后三期(requirement §3.3,运营商个人签名资质停发),本里程碑改为后台鉴权底座——admin 密码登录(手机号 + password_hash,`npm run admin` 建号)+ jose Cookie 会话 + Redis 吊销 + 安全事件日志;后台登录页与 admin shell 双主题(**DESIGN-SPEC v1.0 设计 token 先行**:common.css → globals.css/Tailwind @theme,前台后台同源);原用户中心范围(短信登录/绑定/个人中心/「我的关注」入口)整体移三期 | admin 密码登录闭环;会话吊销生效;安全事件日志可见;M5 后台守卫可依赖 | 已完成(2026-09-30;PR #4 实现 + PR #5 评审修复,合 `6f4c0b3`/`c8a2fbb`;单会话 Cookie jti 双查 + 爆破防护 + middleware 预检 + pino auth 事件;122 单测 + 4 集成 + e2e 登录流;`npm run admin` TTY 建号实测待部署前人工执行一次) |
| M5-a | 内容管理闭环(M5 切片 1/3,2026-09-30 定) | 文章列表(状态分段 全部/已发布/草稿/已下架 + 标题·slug 搜索 + 分页);新建/编辑(Markdown 编辑 + 前台渲染链实时预览 + 分类/标签/摘要/SEO 元栏);发布/下架/软删 + 按需 revalidate 前台即时可见;旧文(contentHtml)只读保真不可改写;状态口径:`draft/published` 双值,下架 = 回 draft 保留 publishedAt,软删 = deleted(应用层 Zod 管控,arch/03 枚举演进条款);封面 M5-a 为路径手填(上传工作流随 M5-b,降级注记);UI 按 DESIGN-SPEC v1.0 + 原型 v0.4.0(admin-posts/admin-editor),Tailwind token 不引 AntD | 后台发布新文章 → 前台即时可见(e2e);下架后前台不可见;旧文编辑被拒;slug 查询全走 normalizeSlug(红线) | 已完成(2026-09-30;PR #6 合 `482c0da`,评审修复 `02508f7`;e2e 用例 6 发布闭环;保存即同步 MediaRef) |
| M5-b | 媒体库与一键发文(M5 切片 2/3) | 上传管线(BullMQ sharp:WebP 副本 + 缩略图 + 宽高回填);媒体库(图片/视频/文件 Tab、引用追踪 MediaRef 落库、孤儿/断链/重复体检、存储统计);**一键发文**:md 导入图片批量上传/外链转存(media.transfer)/自动替换;封面工作流(上传 + 多尺寸裁剪模板);编辑器截图粘贴直传 | 上传图片自动 WebP+缩略图;本地 md 连图一键导入替换;封面按模板一键多尺寸导出;孤儿扫描与批量删除可用 | 已完成(2026-10-01;PR #7 合 `b4640cf`;上传 sha1 去重/回收站软删 7 天 audit 物理清退/引用实时口径 + audit 定时 03:41 投影;媒体删除 409 守卫含《引用方》;视频上传一期拒收(whitelist,STS 直传二期);封面工作流内嵌编辑器元信息栏(非独立原型页,验收场景即编辑器);存储统计实时聚合未走 Redis 缓存(表量级 ~1k);e2e 用例 7 + 集成 14 例;迁移 20260930152518_media_soft_delete 前向追加) |
| M5-c | 统计页与发布 API/MCP(M5 切片 3/3) | **站点统计页**:总览卡片(今日/昨日/近7日/近30日 PV・UV)、PV/UV 趋势图、流量来源(搜索引擎细分/直接/站外 Top/AI 助手类目)、热门页面(时间段筛选)、访客环境分布;**发布 API + 创作 MCP**:Bearer PAT 鉴权(PAT 哈希存储/可吊销/审计)的 upsert_article(slug 幂等)/upload_media/publish,`GET /api/posts` 管理列表 API 一并交付;同应用托管 `/api/mcp` Streamable HTTP 端点;用户管理 | 统计页各模块数据可见且与日聚合表一致;**Claude Code 经 MCP 从本地 md 连图发布草稿→直发闭环,同 slug 重发为更新,令牌吊销后即拒** | 未实现(2026-10-01 评审:顺延为上线后首个线上迭代,不阻塞 M6) |
| M5-d | 编辑器可视化升级与旧文 md 接管(2026-10-01 用户验收反馈立项,M5-c 顺延) | Vditor 分屏 Markdown 编辑器(左编辑右预览/工具栏/截图粘贴直传,运行时资源本地化 public/vditor);后台体验修复:面包屑可点击、列表 slug 解码展示、表单简化(slug/SEO 折叠进高级选项,自动派生冲突加后缀);154 篇 WP 旧文 contentHtml → contentMd 批量回填(scripts/convert-legacy-md,只回填不改写 content_html,可清空回滚) | 分屏编辑/工具栏/粘贴截图入库可用;任一旧文进入编辑器可改并发布;自动派生 slug 撞题出 `-2` 后缀;面包屑中间级可点击返回 | 已完成(2026-10-01;PR #7 合 `b4640cf`) |
| M5-e | 首页 Hub 布局对齐(2026-10-01 上线门槛评审立项) | 按原型 site-home 搭 Hub 布局壳:终端风 hero(whoami + Agent 搜索输入框 + 建议词;输入框一期降级跳基础 /search,Agent 化随 §4 K2)+ 博主文章区真实数据(现首页精选/最新内容收编);电报流/GitHub 区按原型「三区可独立降级」**不渲染**(不落空壳,首页为 SEO 第一页面);深色终端风双主题与 DESIGN-SPEC token 同源;前台登录入口不做(一期不做注册) | 首页布局与 site-home 原型基本一致;降级区无空壳 DOM;PSI 移动端本地口径不回退;e2e 冒烟全绿 | 未实现 |
| M6 | 上线切换 | 生产实跑迁移(以生产库为源);服务器部署(compose prod + nginx + ssl);备份/恢复演练;standard/02-cicd-deployment §5 runbook 执行 + 验收清单;Search Console/百度站长重新提交 | 切换验收清单全勾;观察 1 周后下线 WP | 未实现 |

**发布门槛**:standard/01-testing §7 口径(验收全绿);M6 前必须完成备份恢复演练与全量 verify;上线功能门槛(2026-10-01 用户定稿):admin 登录、主页查看、文章发布、文章编辑四项达标——一期不做注册,前台无用户体系。

## 3. 二期后置池(满足触发条件再立项)

**二期立项顺序(2026-09-30 评审定;选型仍留立项评审)**:① 电报流文字管道(`crawler`)→ ② 电报流短视频解读(`interpreter` 混合流,ASR 选型与首批博主名单评审后)→ ③ GitHub 项目展示 → ④ 首页 Hub 真实数据接入 + **M3 前台视觉升级回补**(深色终端风双主题;布局壳已由一期 M5-e 前置,本条收敛为电报流/GitHub 区接入与全站视觉回补;依赖①②③)→ ⑤ 多渠道分发(公众号)→ ⑥ **付费阅读(二期收尾,最后实现)**;COS 迁移、转码、giscus、GSC 数据等按各自触发条件随时插入。**Agent 搜索与站点内容 MCP 不在本池**——2026-09-30 拆出为独立专项「知识库 + Agent + MCP」(§4)。

| 项 | 触发条件 | 技术预案 |
|----|----------|----------|
| GitHub 项目展示(domonic18 仓库同步 + README 渲染 + 进展动态) | 一期稳定运行;2026-09-30 排序调整:**排在电报流之后**。定位:AI 实践落地项目为主展示,工具类/模板类为后续建设方向,与「人机协同」内容线形成"文章教用法、仓库给武器"联动 | `github` 队列 + BullMQ 定时同步;`github_repo` 表增量迁移 |
| 付费阅读(虎皮椒;35448/38565 已购权益导入) | **二期收尾,最后实现**(2026-09-30 评审定);先完成回调验签与对账设计 | `pay_order` 等表;`/api/pay/notify` 独立鉴权白名单 |
| 多渠道分发·微信公众号(纯 API) | 一期稳定后;开发者模式已就绪(2026-09-29 核实) | `distribute` 队列 + `publish_channel` 状态表;正文图 uploadimg 转存 + doocs/md 式内联样式 HTML + draft/add 推草稿;届时补 arch 文档。CSDN 等无 API 渠道后置,形态届时再定 |
| 封面 AI 文生图(腾讯云混元) | 与微信公众号分发并行或紧随其后 | 标题/摘要生成 prompt → 混元生图 → 多候选选用;与一期封面裁剪模板衔接 |
| AI 资讯管道(自建采集) | 有稳定内容运营节奏后;**2026-09-30 需求细化为「电报流」并升级混合流**(requirement §4):文字资讯 + 短视频解读(抖音博主起步,扩展小红书/B站;版权红线与转写即删见 requirement §1),概要设计与原型 v0.4.0 已落(arch/02-data-collection;原型 site-telegram 混合流 / admin-telegram 治理 / 采集后台三页 admin-spider 采集总览 + admin-channels 渠道配置 + admin-bloggers 博主管理 / site-home 控制台) | Crawlee/BullMQ `crawler` + `interpreter` 双队列 + **复用 Python signer sidecar**([research/01-douyin-signer-eval.md](../research/01-douyin-signer-eval.md));`social_account` 博主表 + telegram `media_type`/视频字段组;ASR/LLM 成本护栏(日预算/告警/时长上限);AI 服务治理后台(模型配置/用量统计/会话管理,arch/04 §4)随②解读管道一并落地;电报表独立于文章库、`/telegram` noindex |
| 多租户博主订阅(「我的关注」;三期) | 三期:站点统一视频解读效果验证后 | `social_account` 加 user 维度;订阅准入/成本配额模型届时设计;轻入口已留(电报流置灰 chip + 个人中心入口卡),不出原型 |
| 长视频切片 + AI 学习笔记(进阶) | 进阶:合作授权拿到长视频之后;**前期不实现、不出原型** | 授权先行(无授权不做);依赖短视频解读管道(`interpreter`)成熟 |
| 短信登录与用户中心(三期;2026-09-30 调整) | 触发:企业主体短信资质办结,或替代认证方案(如本机号码认证)立项评审通过;2026-10-01 复核定稿:一期不做注册,前台无用户体系 | 原 M4 用户中心设计全量保留(requirement §3.3:短信频控/jose 会话/绑定流程/个人中心);`user_account`/`user_pat` 一期已迁就位,启用即增量交付;admin 密码鉴权一期已就位(M4) |
| 图片迁 COS(URL 不变演进) | 流量包压力或磁盘吃紧 | `CosProvider` + Nginx 反代 origin(arch/08-media §1) |
| 视频转码/封面自动化 | 自托管视频更新稳定 | COS 数据万象 snapshot;超规转码再评估 VOD |
| giscus 评论 | GitHub 展示上线后(依赖 Discussions) | - |
| 站内搜索升级 | PG 全文/LIKE 满足不了查询质量 | - |

## 4. 专项:知识库 + Agent + MCP(独立排期,不在二期)

> 2026-09-30 评审定:Agent 搜索与站点内容 MCP 从二期拆出,与站内知识库建设合并为独立专项,单独排期推进(与二期并行或随后均可,不占二期里程碑);设计锚点 [arch/04-ai-agent](../arch/04-ai-agent.md),检索/生成选型留各阶段立项评审。

| # | 阶段 | 内容概要 | 前置与触发 |
|---|------|----------|------------|
| K1 | 知识库检索基座 | 站内三域统一检索 service:`content_post`(教程)/ `telegram`(资讯,含短视频解读)/ `github_repo`(项目)聚合检索;PG 全文(tsvector)起步,pgvector 混合检索评审后定 | 电报流与 GitHub 展示已有数据(排序见 §3);专项立项评审 |
| K2 | Agent 搜索 | 首页控制台输入框 + `/search?q=` Agent 化:AI 答案卡(结论 + 引用角标 [n] 溯源 + 追问建议 + 「AI 生成 · 基于 N 条站内内容」标注)+ 分组命中 + 空态兜底;生成链路(直连 LLM vs 经自有 MCP 复用)评审后定;模型选择与调用记录治理复用 AI 服务后台(arch/04 §4:模型配置/用量统计/会话管理,原型已落) | K1;生成成本护栏设计 |
| K3 | 站点内容 MCP(对外只读) | 同 `/api/mcp` 端点扩对外只读工具集(搜索/读文章),与一期创作 MCP 按鉴权区分工具面;被 AI 引用即 GEO 流量入口 | K1;智能体引用形成一定规模 |
| K4 | RAG 问答入口(远期) | 站内知识库问答(「给智能体看」战略定位的延伸) | K2 稳定运行后 |

## 5. 维护约定

- 状态标注:`未实现` → `实现中(分支)` → `已完成(日期 + PR)`;只在里程碑级维护,完成后归入 §1 基线一句话,过程不回填
- 范围变更:先改 requirement,再同步本文与相关 arch 文档,三者不一致以 requirement 为准
- E2E 与迁移对账的切换前全量执行结果,记录在 M6 行的完成备注中
