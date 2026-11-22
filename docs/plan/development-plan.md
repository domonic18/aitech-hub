# 功能开发计划

> 需求基准:[requirement/01-requirement.md](../requirement/01-requirement.md);终态方案见 [arch/](../arch/)。
> 本文只维护**里程碑级状态**,已完成的里程碑压缩为一行概括——实现细节以代码、`prisma/schema.prisma`
> 与对应 arch 章节为准,演进过程见 git 历史。文档体系与维护纪律见 [docs/README.md](../README.md)。

## 1. 当前基线

- **M1–M74 全部完成**(一期骨架/迁移/前台/后台/上线;二期采集·AI·创作·分发·商业化逐迭代交付;M58–M65 为数据面扩展与洞察 v2 + 短信登录收口;M66–M71 公众号问答/列表与阅读页增强/答案卡与首页动态词/外部 Agent 能力面;M72 创作面瘦身外移;M74 模型牌价按量比价全批次收官)。生产镜像随 develop→main 发布滚动更新。
- **M58–M65 概括**:M58 多语言/地域基座 + 厂商事件 + 榜单公开页 + 社区需求语料 + 问句清洗复活([data-expansion-plan](data-expansion-plan.md));M59 洞察浏览与实体层;M60 实体分层/覆盖矩阵/未命名治理;M61 洞察体验与准入修复;M62 数据库命名规范化([standard/03-db-naming](../standard/03-db-naming.md));
  M63 榜单公开页可视化(三节散点 / 双币切换 / 零 JS 悬停卡);M64 榜单口径与实体层打通;M65 手机号短信登录(阿里云 PNVS,[arch/05 §3.4](../arch/05-services.md))。
- 站点能力面:内容站(文章/贴图两形态,专题形态已随 M72 下线)+ SEO 无损迁移 + 多渠道采集(电报流/抖音/B站/热榜/通用网页通道)
  + AI 管线(ASR 解读/打标判定/洞察)+ 创作面(配图工坊/站内 AI 封面/卡片渲染 sidecar;**内容创作职责已外移线下 Claude Code,MCP 25 只工具 + 仓库写作指南**)
  + 分发(公众号/小红书)+ 商业化(付费阅读/模型牌价页)+ 后台全套(内容/媒体/采集/洞察/统计/会话/用量)。
- 未交付:RAG 问答(K4,未排期)。原「296 用户短信登录」阻塞已由 M65 解除:
  243 个有手机号的老用户可直接短信登录;56 个无手机也无邮箱的账号(多为 53 个 pending_binding 老用户)
  按既定裁定不做特殊处理,回访时走「不存在即自动建号」。
- 站点内容 MCP(K3)**2026-11-13 复活立项**(原「已否决」口径作废)——落 M71。

## 2. 里程碑

| 里程碑 | 主题 | 概括 |
| --- | --- | --- |
| M1 | 骨架与基建 | 目录树、根 CLAUDE.md、Makefile/env、CI 与容器基座 |
| M2 | 迁移脚本 | WP 抽取→转换→媒体清单→装载→verify 七步管线(可 dry-run) |
| M3 | 前台 | 布局/首页/详情/列表/分类/标签/归档/搜索/协议页 + SEO·ISR |
| M4 | admin 认证基座 | admin 密码鉴权上线;用户短信登录收缩至三期 |
| M5-a | 内容管理闭环 | 文章列表/编辑/状态流转后台闭环 |
| M5-b | 媒体库与一键发文 | 上传管线(WebP/缩略图)+ 媒体库 + 一键发文 |
| M5-c | 统计页与发布 API/MCP | 站点统计页 + 发布接口与创作 MCP 通道 |
| M5-d | 编辑器可视化升级 | Vditor 可视化编辑 + 旧文 markdown 接管 |
| M5-e | 首页 Hub 布局 | 按原型落 Hub 首页壳 |
| M6 | 上线切换 | 生产迁移实跑、部署/nginx/ssl、备份恢复演练、旧站切换 |
| M7 | 电报流·文字管道 | 源/信号/屏蔽词三表 + 抓取与净化 worker |
| M8 | 抖音采集管道 | 签名/TLS 指纹/Cookie 风控基建 + 抖音采集(数据网关 sidecar) |
| M9 | 抖音 ASR→LLM 解读 | 抽音→转写→解读入文管道 |
| M10 | 六项体验反馈修复 | 首轮生产体验反馈六项收口 |
| M11 | GitHub 项目展示 | 仓库同步 + README 渲染 + 进展动态 |
| M12 | 站点体验优化 | 生产反馈五项优化 |
| M13 | 后台移动端适配 | 后台各页移动端布局适配 |
| M14 | 后台验收反馈八项 | 后台验收八项收口 |
| M15 | 电报流验收反馈四项 | 电报流验收四项收口 |
| M16 | 后台验收反馈八项(二轮) | 第二轮八项收口 |
| M17 | 公众号草稿箱同步 | 文章同步微信公众号草稿箱(分发首渠道) |
| M18 | agent 发文通道收口 | 带图文章经 MCP 单请求整文入库 |
| M19 | COS 体系 | 备份异机存放 + 图片迁 COS(URL 不变) |
| M20 | 站内搜索升混合检索 | 向量 + 词项混合检索替代纯 ILIKE 匹配 |
| M21 | 付费阅读·虎皮椒 | 下单/回调核验/订单权益闭环 + 旧单迁移 |
| M22 | 用户中心 + 悬浮 AI 助手 + 反馈 | 账户中心、全站悬浮助手、反馈系统 |
| M23 | 评论 + 点赞 + 旧评论迁移 | 站内评论与点赞,旧站评论迁移 |
| M24 | B站视频适配器 | B站采集适配器,复用风控基建 |
| M25 | 优质内容发现机制 | 热词/博主/热点视频发现([discovery-plan](discovery-plan.md)) |
| M26 | 专题内容管线 | 专题拟定→视频解读→专题文档→草稿箱([topic-pipeline-plan](topic-pipeline-plan.md)) |
| M27 | 编辑器 AI 化 | 对话改稿 + diff 评审 + 自动保存([editor-ai-plan](editor-ai-plan.md)) |
| M28 | 统计扩展·行为与在线 | 点击行为上报与实时在线统计 |
| M29 | 飞书工作台免登 | admin 经飞书工作台 H5 免登 |
| M30 | 写作 skill 化 + 字数预算 | 写作指南下沉 skill + 公众号字数预算 |
| M31 | 图文卡片·HTML 渲染成图 | 卡片渲染 sidecar + 图文组件库 |
| M32 | 视频关键帧解析入文 | 关键帧抽取与插图入文 |
| M33 | B站风控池治理 | voucher 池耗尽的系统性治理 |
| M34 | 洞察中心 | 热点舆情 + 用户痛点挖掘([insight-plan](insight-plan.md)) |
| M35 | Agent 宿主唯一化 | 全站单一 Agent 宿主,工具按页面注册 |
| M36 | 可视化卡片体系 | 「1页·2系·7型·1纪律」文章卡片体系 |
| M37 | Agent 输出预算治理 | 输出预算 + 撰写文章单任务捆绑 |
| M38 | 卡片视觉系统 | 卡片视觉重构 |
| M39 | 文生图插画与形式扩容 | 插画生成与内容形式扩容(topic-pipeline §13) |
| M40 | 会话视觉输入 + 配图工坊 | 会话视觉输入 + Seedream 图层配图工坊 |
| M41 | 贴图工作台 newspic | 「小绿书」贴图内容形态 |
| M42 | 创作中心(专题管理重构) | 专题管理重构为端到端创作台 |
| M43 | 创作中心 v2 | 三栏工作台交互重构 |
| M44 | 状态驱动引导式交互 | 按定稿原型落状态驱动引导 |
| M45 | 贴图/创作验收反馈两批 | 参照图轨入口补齐等两小批收口 |
| M46 | 后台 UI/IA 对齐 v5 | Ardot 板落码(创作域/配图/分发/IA 迁移/洞察 UX) |
| M47 | 技术债清理迭代 | 全仓 code review 分批清债 |
| M48 | 偿债 + 扩前体检 | 七批体检收口(含首载瘦身) |
| M49 | 小红书分发渠道 | 贴图经 Playwright 发布打通([xhs-auto-publish-design](xhs-auto-publish-design.md)) |
| M50 | 渠道化收口批 | 渠道抽象收口 + 前序迭代清账 |
| M51 | 公众号排版对标增强 | 公众号排版对齐 doocs 样式规范 |
| M52 | 洞察中心多维分析 | 簇趋势分级、源×簇矩阵、多维读侧 |
| M53 | 洞察打标接 Jev | 判定半场接入结构化决策模型,高置信覆判 |
| M54 | 多领域洞察 | 领域分类管线 + 分桶 + 词表管理 |
| M55 | 牌价速查页 `/pricing/` | 模型牌价速查与比价页 |
| M56 | 通用网页取数通道 | headless 渲染取数 + 牌价渠道注册表 |
| M57 | 牌价页收尾销账 | M55/M56 收尾与销账 |
| M58 | 数据面扩展与洞察 v2 | 多语言/地域基座 + 厂商事件 + 榜单公开页 + 社区需求语料 + 问句清洗([data-expansion-plan](data-expansion-plan.md)) |
| M59 | 洞察浏览与实体层 | 信号独立页 + 实体聚合视图与详情([data-expansion-plan §14](data-expansion-plan.md)) |
| M60 | 洞察三项治理 | 实体主表/别名/归并 + 覆盖矩阵渠道族重构 + 未命名打标收敛([data-expansion-plan §15](data-expansion-plan.md)) |
| M61 | 洞察体验与准入修复 | 实体恒出页 + 问句入池 fail-closed + 实体列表窄屏 |
| M62 | 数据库命名规范化与结构收口 | 表名前缀归一 + 索引/主键规范 + 外键补齐 + 明细表审计字段;规范落 [standard/03-db-naming](../standard/03-db-naming.md) |
| M63 | 榜单公开页可视化改版 | `/leaderboards/` 三节并列:模型能力与价格(能力分 × 输出价散点)/ Hugging Face 热门模型(下载量 × 点赞数双对数散点)/ 热门仓库(动量卡:今日上升最快 + 新入榜;论文榜前台移除、采集保留);展示字段下沉 `meta` 白名单(无 schema 变更),AA 入库扩至 60;v2.1 输出价支持 USD ⇄ 人民币切换(默认人民币,汇率每日 04:43 自动采集落 `site_config`,零 JS 切换);v2.2 三节标题区署名数据来源并可一键回原站([data-expansion-plan §6.3](data-expansion-plan.md));v2.3 散点悬停零 JS SVG 卡 + 标注厂商保底与全厂商图例 |
| M64 | 榜单口径与实体层打通 | 榜单快照 `entityKey` → 实体解析(唯一出口)+ 采集写入落 `entity_id`(AA / HF 两榜)+ 实体详情「榜单表现」与列表「在榜」+ 存量回填([data-expansion-plan §16](data-expansion-plan.md)) |
| M65 | 手机号短信登录 | 阿里云 PNVS 短信认证替代原三期腾讯云方案:登录/注册合一(不存在自动建号)、admin 禁短信登录、频控 + 日预算熔断 + 校验锁定、验证码服务商托管不落库;后台「系统设置 → 短信」配置与探针;合规同意勾选 + 隐私政策第三方条款;`/account/*` 会话 Redis 双查收口([arch/05 §3.4](../arch/05-services.md)) |
| M66 | 公众号私信问答接管 | **已实现待验收(2026-11-01,`feature/wechat-mp-bot`)**。承接旧 chatgpt-on-wechat 服务的公众号私信应答:回调端点验签+AES 解密+`MsgId` 幂等,三档回复(关键词直连 / 站内检索+LLM 4.2s / 超时「继续」回捞),答案强制站内引用且无命中不生成;转人工线索 + 飞书站务通知(凭据入库,「系统设置 → 站务通知」);后台会话/关键词(「分发 → 公众号会话」),接入配置在「系统设置 → 公众号」(`/admin/settings/wechat-mp/`,旧 `/admin/wechat-mp/config/` 308);一次性绑定码打通站内账号(账号设置页);明细 180 天清理。**2026-11-01 线上反馈修复**:answer jobId 用入站 `dedupeKey`(`msg:<MsgId>`)拼装,BullMQ 禁冒号致 `add` 抛错、所有非关键词消息被降级成错误话术——改按落库消息 id(`wxmp-<id>`);同时新增 `texts.error` 系统错误话术,与「站内没找到」区分;「继续」加 3.4s 短轮询(实测生成 3–8s,超 4.2s 窗口的用户回「继续」即取答案,不再空手而归);**2026-11-01 转人工闭环**:认证订阅号无客服消息权限,改为留言式——站长在会话详情写答复入队(`manual_reply`,TTL 7 天),用户下次任意发言时被动回复带出一次(前缀「【站长答复】」,`reply_kind='manual'`),线索加 `replied` 态,AI 全程不暂停(删掉「清空后 AI 恢复」的假承诺);飞书卡片链接改 **AppLink** 端内打开(`toFeishuInAppUrl`),配合 M29 免登不再跳出飞书重登([wechat-mp-bot-plan](wechat-mp-bot-plan.md) §6.1,[arch/05 §4.10](../arch/05-services.md)) |
| M67 | 文章列表页重构 | **已完成(2026-11-01)**。/articles 改文章+已发布贴图按 publishedAt 混排的统一内容流(两源并发计数→头部归并切片,深页不重不漏 `article-feed.ts`);双视图带图(列表缩略图/卡片 16:9,贴图「N 图」角标);分类行+标签 Top10+`<details>` 更多(零 JS);统一 `--site-max-w` 版心;顺手修分页 `originalOnly`、贴图失效 `revalidatePinPaths`。不改 schema([arch/07 §1](../arch/07-frontend.md)) |
| M68 | 文章阅读页增强 | **已完成(2026-11-01)**。左侧 TOC(H2+H3,md 与 content_html 同 slug pipeline)、xl 三栏/lg 两栏/窄屏折叠;右下「回到顶部」;右栏最近文章+电报(`PostRail`/`TelegramRail`);文末上一篇/下一篇;版权声明后台可配(`site_config.post.copyright_md`)。详情页仍 ISR 600s,不改 schema([arch/07 §1、§8](../arch/07-frontend.md)) |
| M69 | 文章页助手上下文 + 电报流增强 | **已完成(2026-11-01)**。文章页助手注入文章上下文(`read_post` 按身份换档,门禁文 ≤800 字预览 fail-closed);/telegram 右栏「采集计划」卡(显式白名单排除运维类,台账异常降级);回顶复用;底部「加载更多」(30 条/页游标,与 60s 轮询去重互不干扰)([arch/04](../arch/04-ai-agent.md)、[arch/07 §1](../arch/07-frontend.md)) |
| M70 | 答案卡引用分行 + 首页快捷搜索词 | **已完成(2026-11-01)**。/search 答案卡引用改 ol/li 逐条成行(cite-N 锚点保留);首页快捷建议词去硬编码——`site_config.home.search_terms`(后台勾选固定词+个数,洞察关键词云自动补齐,词云空回退内置),装配 `lib/config/home-search-terms.ts`(prerenderSafe)([arch/07 §1](../arch/07-frontend.md)) |
| M71 | 外部 Agent 能力面(K3 复活) | **已完成(2026-11-13)**。外部智能体经 `/api/mcp/` + admin PAT 接入:只读 4 工具(热点簇/电报条目/三域检索/播放直链)+ 写通道恒落草稿 + `.md` 整包上传 + 作者归属列;逐字稿按版权红线不做([arch/04 §3.6](../arch/04-ai-agent.md)) |
| M72 | 站内创作面瘦身(创作职责外移线下) | **已实现(2026-11-15,PR #244~#251;B0~B5/B7/B9 逐批合 develop 并发布 main)**。站内创作职责整体外移线下 Claude Code:①**MCP 工具面 21 → 25 只**(只读 9 + 文章面 9 + 贴图面 7),新增 `list_skills`/`get_skill`/`list_drafts`/`update_pin`,错误出参统一 `{ok:false,code,message,retryable,hint}`,批量入库 `POST /api/posts/bundles`;②**写作指南真相源 = 仓库 `skills/writing/*.md`**(站内 agent_skill 表 + 后台「写作技能」页 + `/api/agent-skills/**` 退役),线上 MCP 与线下助手读同一份,改指南不再需要发版;③**专题台账(创作中心)整层退役**(`/admin/studio/**`、`/api/topics/**`、洞察「生成选题」、`topic`/`topic_item`/`writing_sample_image` 三表 + `content_pin.topic_id` 列),用户拍板「彻底删」;④**站内 agent 写侧退役**:19 只写工具与 admin 专属提示段整体删除,工具面塌缩为**全员只读六件**(admin 与访客同面),admin 档配额随之降到 user 档(12/50k);⑤保留面:**站内 AI 封面**(D3,改 HTTP 触发 `POST /api/posts/cover-candidates`)、公众号分发、媒体库/配图工坊/贴图/文章管理;⑥线下闭环剧本见 [standard/04-creative-loop-acceptance](../standard/04-creative-loop-acceptance.md),评估稿见 [creation-center-slimming-plan](creation-center-slimming-plan.md)(§0.2 批次进展) |
| M75 | 运营巡查能力面(MCP 运维面) | **已实现待验收(2026-11-19,`feature/m75-ops-mcp`)**。给站长本地运营助手 agent 用:巡查采集健康度并由 agent 侧发飞书周报(站内不开放代发消息工具)。MCP 工具面 25 → 29 只,新增运维面 4 只:`get_health_snapshot`(牌价源/文章渠道/视频博主/队列与 AI 管线四域 + 结构化 problems[])、`get_health_failures`(失败明细与错误原文)、`trigger_recovery`(仅入队的手动重采,同目标 5 分钟冷却)、`review_model_pricing`(牌价上架/下架:上架须 confirm+reason+逐条 ids,带「待复核」标或源不健康被拒,下架为止损不受闸)。沿用既有分工:能力在 service 层、MCP 直调 service,HTTP 路由的 PAT 拒不动。阈值与闸门集中在 `src/lib/collect/health-report.ts` 纯函数。落点 arch/04 §3.6;红线见根 CLAUDE.md。遗留:只读工具暂不单独限频(按审计日志再定);建议给巡查 agent 单独签一枚 PAT |
| M76 | 牌价按源批量下架 | **已实现待验收(2026-11-19,`feature/m76-pricing-source-offline`)**。新增 MCP 工具 `offline_pricing_source`:牌价采集源抓取失败时,把该源名下已上架的行批量下架(止损);只下架不上架,该不该下架由 agent 侧判断。顺带修牌价源健康读的产出面口径(套餐源此前统计的是同厂商模型行),并拆分牌价管理面(`pricing/admin.ts` → `admin-schema/admin-model/admin-plan/offline-source`)。落点 arch/04 §3.6;红线见根 CLAUDE.md。 |
| M77 | 牌价后台批量动作 + 图片分辨率口径 | **已实现待验收(2026-11-20)**。①**后台牌价补齐批量动作**:勾选后可批量上架/下架/**删除**(过期采集行此前只能逐行删)——`DELETE /api/pricing/models/bulk` 不可逆,人工定稿行跳过并回报计数;措辞统一到全站口径「上架/下架」。②**文生图/文生视频按分辨率分档**:采集侧补上方舟图片表的多档价格格解析(格内零宽字符分段、按输出总像素与生图场景分档),百炼行价基准改为**最低分辨率档**并在 note 注明分辨率;前台输出价下标注「对应分辨率」,模型名下可展开各分辨率档位价。**行价仍是基准价,不是最便宜那档**(与 token 表「全球档/最小输入长度档」同原则)。前端表头口径与 arch/07 §1 一致。 |
| M78 | 采集源解析器修复(AA 榜单 + 腾讯 Token Plan) | **已实现待验收(2026-11-22)**。生产排查发现两个源连续失败,均非网络问题:**Artificial Analysis 智能指数榜**(11-14 起连败 8 次,榜单数据停在 11-13)——页面载荷改版,模型 slug 从顶层下沉到 `release.slug`,解析器仍取顶层 `slug` → 288 个模型全落空;**腾讯云 Token Plan**(11-18 起连败,8 条套餐被打「待复核」)——活动页把同一批卡嵌了两遍(比价区 + 购买区),档数校验数成「Hy 8/通用 8」误判为改版。修法:slug 取 `release.slug ?? slug`;套餐卡按(系列,档位,价)去重后再校验(同档不同价不去重 → 仍抛错暴露歧义)。两处均以线上真实页面/快照复现验证(修后 AA 取 69 条、Token Plan 取 8 档)。余留(中/低优先级):`vendor:google` 境内 TLS 停滞(建议走系统出口代理)、`The Decoder` 15s 超时偏紧。 |
| M74 | 模型牌价 · 按量比价 | **已完成(2026-11-15 立项 → 2026-11-18 全批次收官,`feature/m74-*`,PR #257~#283)**。国内主流厂商按量模型牌价系统采集(DeepSeek/Kimi/硅基流动/腾讯混元/阿里百炼/火山方舟/百度词元所聚合,模型面日级)+ 跨厂商比价可视化 + 免费双标识 + 按用途归类(页签/单位感知/生成价条形图)+ 价格变更史(`model_pricing_change`,只记采集侧)。前台 `/pricing/`(列表/比价/图表三视图 + 左侧筛选栏,SSR 全量行红线)与 `/pricing/changes/`(降价史);后台 `/admin/pricing` 策展(批量终审/档位订正/源健康度)。数据口径(原币直出、代表价、币种×单位分区才可比、墓碑)与批次对照见 [model-pricing-plan](model-pricing-plan.md) 基线摘要;表结构 arch/03 §2.4,采集契约 arch/01 §4/§5,前台 arch/07 §1。遗留:海外厂商源留池;生产 pending 行终审(运维) |

## 3. 后置池(满足触发条件再立项)

| 项 | 触发条件 | 技术预案 |
| --- | --- | --- |
| 多租户博主订阅(「我的关注」) | 视频解读效果验证后(三期) | `social_account` 加 user 维度 + 订阅配额模型;轻入口已留 |
| 长视频切片 + AI 学习笔记 | 拿到长视频合作授权 | 依赖解读管道成熟;无授权不做 |
| ~~短信登录通道~~ | 已由 M65 落地(阿里云 PNVS 短信认证,见 §3.4) | 原保留的用户中心设计已按 M65 增量交付;绑定/改绑手机号随 M65 P1 落地(`/account/settings`) |
| 视频转码/封面自动化 | 自托管视频更新频繁 | COS 数据万象 snapshot;超规转码再评 VOD |
| 站内搜索再升级 | 混合检索质量再遇瓶颈 | 见 arch/04 §3 检索锚点 |
| `/articles/page/[page]` 非法段返回 200 + 404 正文 | 下次前台 SEO/分页迭代 | 根因:`(site)/articles/loading.tsx` 的 Suspense 边界先冲刷响应头,`notFound()` 落在其后,只能改状态码语义而改不了已发出的 200(分类/标签无 loading 边界,同判据返回 404)。预案:①`/articles/page/1/` 用 `next.config` redirects 或 middleware 做 308 归一(canonical 更有利);②非法段(`abc`/`0`/负数)在 middleware 直接短路 404,不进 RSC 流式;③保留 skeleton 就不依赖 `notFound()` 的状态码 |

## 4. 专项:知识库 + Agent + MCP(独立排期)

| # | 阶段 | 状态 |
| --- | --- | --- |
| K1 | 知识库检索基座(内容/资讯/项目三域统一检索) | 已完成 |
| K2 | Agent 搜索(答案卡 + 引用溯源 + 配额与缓存护栏) | 已完成 |
| K2.5 | 搜索 Drawer 会话 Agent(LangGraph + assistant-ui,SSE) | 已完成 |
| K2.6 | 游客模式 + 后台会话管理 + 工具面收紧 | 已完成 |
| ~~K3~~ | ~~站点内容 MCP(对外只读工具集)~~ | **复活立项(2026-11-13)**,落 M71;口径见 arch/04 §3.6 |
| K4 | RAG 问答入口 | 未排期 |

## 5. 维护约定

- **状态只写里程碑级**:`未实现` → `实现中(分支)` → `已完成`。完成后该行压成一行概括
  (做了什么 + 落在哪个 arch 章节),实现细节不回填、不留在计划里。
- **范围变更**:先改 requirement,再同步本文与相关 arch 文档;三者不一致以 requirement 为准。
- **发布门槛**:见 [standard/01-testing](../standard/01-testing.md) §7(验收全绿);迁移/切换类
  必须完成备份恢复演练与全量 verify。
- **过程产物不长期驻留**:评审清单、一次性订正记录应用完成后删除,历史由 git 保留。
