# 数据采集设计(电报流)

> 状态:概要设计(2026-09-30,随「电报流」需求细化立此存照;二期立项时评审后再实现)。
> 需求基准见 [requirement/01-requirement.md §4](../requirement/01-requirement.md)「电报流(AI 资讯产品化)」;UI 原型(v0.4.0):前台 [site-telegram](../prototypes/site-telegram.html),治理后台 [admin-telegram](../prototypes/admin-telegram.html),采集后台三页 [admin-spider](../prototypes/admin-spider.html)(采集总览)/ [admin-channels](../prototypes/admin-channels.html)(渠道配置)/ [admin-bloggers](../prototypes/admin-bloggers.html)(博主管理)。

## 1. 定位与产品形态

**电报流** = 站内短讯流产品:后台 spider 定时爬取 AI 相关资讯渠道,清洗过滤后生成 1-3 句摘要"电报",前台以实时感方式滚动展示,让用户感知「有 AI 在实时获取互联网 AI 资讯」。它是 requirement §1「不追资讯量、做可信信息源」的资讯侧落法:**短、少、准,人设是"站长的 AI 信息触达回路",不是资讯站**。

**混合流升级(2026-09-30)**:电报流从纯文字资讯扩展为「文字 + 短视频解读」混排——对指定短视频博主(抖音起步,扩展小红书/B站)的视频做 ASR 转写 + LLM 结构化解读,产出「主题 + 摘要 + 关键要点」电报卡入同一条流;前台媒体类型筛选(全部/文字/短视频)。准入纪律不变:视频电报与文字电报共用过滤/屏蔽词/去重约束;**内容边界(2026-09-30 评估补充)**:仅 AI/科技垂类聚合外链,不做时政新闻自采(避开《互联网新闻信息服务许可》边界,作为过滤规则之外的明示红线)。

与旧 3314 条弃用资讯的本质区别(旧站教训的制度化):

| | 旧资讯(fat-rat-collect) | 电报流 |
|---|---|---|
| 内容形态 | 整文入库,伪装文章 | 1-3 句摘要 + 原文外链 |
| 存储 | WP posts 表,与文章混排 | 独立 `telegram` 表,不进文章库 |
| SEO | 被搜索引擎收录,低质拖累全站 | `/telegram` 路由 **noindex**,不进 sitemap/RSS |
| 准入 | 爬到即发 | 规则过滤 + 屏蔽词 + 去重,默认从严 |

## 2. 数据模型锚点(终态字段草案,实现时进 arch/03 + Prisma migration)

- `crawl_source` 渠道表:`id / name / type(rss|web|api|social-video) / platform(douyin|xhs|bilibili,type=social-video 时) / url / enabled / crawl_interval_min / daily_max_requests(每日请求上限,超限当日跳过,null=不限;2026-10-03 立项新增) / last_run_at / next_run_at / status(healthy|degraded|error) / config(Jsonb 适配配置:type=api 存 {apiKey} 等;后台维护,展示脱敏、日志禁打——凭证不走环境变量,2026-10-03 用户定) / 备注`;视频博主渠道与普通渠道同表管理,`type` 区分
- `social_account` 视频博主表(2026-09-30 新增锚点,二期评审):`id / platform / sec_uid 或平台用户 ID / 昵称 / avatar_url / 分类标签 / enabled(启停) / crawl_interval_min / asr_success_rate_7d(观测字段) / remark / created_at`;登记入口在 admin/spider「短视频解读服务」卡(视频链接或 sec_uid + 昵称 + 分类,重复登记 409);删除走**两步武装删除**(先停用观察再物理删)
- `telegram` 电报表:`id / source_id / title / summary(1-3 句) / url(原文外链) / published_at / content_hash(去重,sha1(title+url 规范化)) / status(visible|hidden|archived) / filter_hit(命中的过滤规则,nullable) / created_at`,混合流扩:**`media_type(text|video)`** + 视频字段组 `video_platform / video_blogger(冗余博主名,博主删除不影响历史条目) / video_cover_url(封面缩略图) / video_duration / video_engagement(jsonb:play/like/comment)`;**不设 transcript 字段**——转写文本不落库(§3.2 红线)
- `blocklist` 屏蔽词表:`id / word / scope(title|summary|all) / hit_count / enabled / created_at`
- 过滤规则一期内置代码级启发(广告特征、标题党、编码异常),不做规则表;命中统计写 `telegram.filter_hit` 供后台观测

**落地注记(2026-10-04,M8 批② 已交付)**:视频渠道与普通渠道**不同表混管**——`crawl_source` 每**平台**一行(`type=social-video + platform=douyin`,`name=social:douyin`,承载 Cookie 池密文 config/平台总开关 enabled/日上限 daily_max_requests,**自身不调度**);博主个体落 `social_account` 与平台行 **N:1**(`platform+sec_uid` 唯一),携带独立调度字段(`crawl_interval_min 默认 180 / last_post_at 增量地板 / last_run_at / next_run_at / consecutive_fails / last_error`)。`asr_success_rate_7d` 随解读批后置。Cookie 池为**平台级**共享(非博主级):AES-256-GCM 密文存平台行 `config.cookieJars`(密钥 env `APP_COOKIE_ENC_KEY`,32 字节 base64,空=导入禁用);导入校验 ≥3 组键值对且含 `ttwid`(薄 jar 防呆——ttwid-only 拿到 200 空响应),同 ttwid 视为同身份覆盖合并;展示只出脱敏 ttwid 前缀。`telegram` 视频字段组同上落地,**play_url 不落库不下载**(版权保守模式)。

## 3. 采集管道(worker,BullMQ 双队列:`crawler` + `interpreter`)

### 3.1 文字管道(`crawler`)

```
调度器(per-source interval)→ 渠道适配器(Crawlee;RSS 直接 parse)
  → 清洗(正文/标题抽取、HTML 剥离、长度截断)
  → 过滤(广告/低质启发式 → filter_hit 标记,默认不Visible)
  → 屏蔽词命中 → 同上
  → content_hash 去重(命中即丢弃)
  → LLM 摘要(可选,二期评审;先规则截断)→ 入库 status=visible
```

- 频控:每渠道独立 `crawl_interval_min`(默认 ≥30min),对目标站遵守 robots.txt 与 UA 规范
- **每日请求上限(2026-10-03 立项定)**:每渠道独立 `daily_max_requests`(如机器之心 60min/日 25 次);worker 以 Redis 按渠道按日 INCR(key 含日期,TTL 48h)计数,超限当日剩余调度直接跳过——warn 日志、不计失败、不影响健康度,次日自然恢复
- 失败处理:连续失败 ≥3 次 → source.status=error 并在采集后台标红;不阻塞其他渠道
- 队列复用 arch/05-services §4 二期任务划分;抖音等签名渠道复用 Python signer sidecar(research/01)

**落地注记(2026-10-04,M7 批③/⑤ 已交付)**:适配器一期仅 `rss`(fast-xml-parser,RSS/Atom 双格式;`token` 等凭证经 `crawl_source.config` 注入、拼为 query 参数,报错信息不回显 URL 防外泄);**HTTP 429 特判** = 供应方限频(`RateLimitedError`)不计失败、来源保持 healthy、顺延下轮(机器之心免费档 60min/次实测);队列装配 = BullMQ `upsertJobScheduler("crawler-tick")` 每 60s 扫描到期渠道,per-source job 以 `crawl-{id}-{nextRunAt}` 幂等去重;入库编排 = 日上限(Redis INCR 跳过不计失败)→ 适配器 → canonical_url/content_hash 双重去重 → 启发式+屏蔽词 → 规则截断 → visible/hidden。前台落地见 arch/07 §1 `/telegram` 行。

### 3.2 短视频解读管道(`interpreter`,2026-09-30 新增)

```
博主 listing 轮询(crawl_interval_min ≥120min)→ 视频幂等入库 shell
  (标题/封面/时长/外链,media_type=video,先降级可见)
  → 无水印流下载(平台适配层;抖音走 signer sidecar research/01)
  → ffmpeg 抽音轨 → 云 ASR 转写
  → LLM 结构化解读(主题分类 / 1-3 句摘要 / 关键要点,JSON schema 约束)
  → 电报卡入库 + 转写文本即删(临时音轨/文稿一并清除)
```

- **版权红线(全站硬约束)**:「转写是输入,不是资产」——仅持久化**分析结论、摘要、封面缩略图、原文外链**四样;不存储/不分发视频原片与完整文稿;临时音轨与转写文本在解读判定后立即删除(即删,非定时清理)
- **降级**:ASR 失败(重试 ≤2)→ `转写缺失` 降级入流:仅主题 + 外链,不阻塞;失败计入 `social_account.asr_success_rate_7d`
- **成本护栏**:日预算(默认 $5,超 80% 告警)+ 单条音频时长上限(超长跳过解读,仅 shell 入流)+ 单条重试 ≤2;ASR/LLM 用量按日聚合进 admin/spider 服务卡;选型评审时锁定**单条 LLM 解读成本上限**
- **资源约束(2026-09-30 评估)**:`interpreter` 队列并发锁 1——ffmpeg 抽音轨是 CPU 峰值,2C4G 单机 worker 串行消化;临时下载为服务器入流,不占出站带宽
- 博主停用/删除不影响已入库电报(`video_blogger` 冗余);前台展示边界见 §6

**落地注记(2026-10-04,M8 已交付;本批边界)**:上图管道仅交付前两环——**博主 listing 轮询 → 视频幂等入库 shell**(标题/封面/时长/互动数/原视频外链,`media_type=video`,即时可见)。**无水印下载 → ffmpeg → ASR → LLM 解读整段后置独立立项**(ASR/LLM 选型未评审,§7 成本锚点届时沿用;`interpreter` 队列不建)。合规保守模式:**`play_url` 不落库不下载**(§2 注记),版权红线四样收敛为「结论(后续解读批)/封面缩略图/外链」。采集基建为 Python 网关 sidecar `douyin-gateway/`(签名 a_bogus + Chrome TLS 指纹 transport + Cookie 池轮换,compose 内网服务,契约见 arch/05 §4.4);Node 侧仅编排(`crawl-video` job 走 BullMQ `crawler` 队列,与文字渠道同 tick 调度器,`crawlDueSources` 已排除 `type=social-video` 行防双扫)。无 AI 解读,前台视频卡**不显 AI 生成标注**(§6 标注随解读批落地);降级/成本护栏/asr_success_rate_7d 同批后置。

## 4. 治理(后台 admin/telegram)

- **CRUD**:列表(筛选:渠道/**媒体类型(text|video)**/状态/日期/关键词)+ 编辑(标题/摘要)+ 隐藏/恢复 + 归档 + 删除(软删);视频行展示封面缩略图/平台徽标/博主/解读摘要/原视频链与转写缺失降级态
- **过滤观测**:进流数 / 过滤拦截数 / 屏蔽词命中数 / 短视频解读数,按日聚合
- **屏蔽词管理**:增删改 + 命中计数;新增屏蔽词可选"回溯隐藏存量命中"
- **版权投诉通道(2026-09-30 评估补充)**:前台公示投诉入口,投诉 → 即时隐藏/下架 → 必要时与博主沟通;处置留痕,与条目 CRUD 同一治理面板(著作权争议的快速响应机制)
- **归档与清理**:`visible` 超过 N 天(默认 90)自动转 `archived`(BullMQ daily 任务);archived 不在前台展示;清理 = archived 超 M 天物理删除,后台手动触发 + 确认弹窗

## 5. 采集管理后台(admin;原型 v0.4.0 定为三页)

- **采集总览(admin/spider)**:worker 心跳与存活、`crawler` / `interpreter` 双队列深度(completed/failed/active/delayed)与排队实况、各渠道最近 24h 采集条带图、**采集日历**(月网格,按日聚合采集量色阶——回答"哪天采了什么、哪个渠道断了")、最近错误列表;数据全部来自 BullMQ 队列 API 与 crawl_source/telegram 聚合,不引第三方监控
- **渠道配置(admin/channels)**:文字资讯渠道台账——类型(rss|web|api)/URL/频控 interval/启停/健康状态(healthy|degraded|error)/最近采集与 24h 条数,调试·编辑·删除;停用不删数据;视频博主不在此表(见博主管理)
- **博主管理(admin/bloggers)**:短视频博主台账——登记(主页链接或 sec_uid + 别名 + 分类 + 轮询间隔 + Cookie 加密落库,409 重复)/启停/最新作品与最近采集/**ASR 7d 观测**(成功率/转写缺失告警)/最近错误(a_bogus 签名失效等);页顶双状态卡 = 采集适配层(signer sidecar/Cookie 池)+ ASR 转写队列;删除两步武装(先停用再物理删)+ 版权边界注记(§3.2 红线)。**落地注记(2026-10-04,M8 批③ 已交付)**:登记即「主页链接/口令/sec_uid」三态输入,经网关 `/resolve`+`/profile` 自动拉昵称头像(不可达时昵称手填兜底);Cookie **平台级**导入而非随博主落库(§2 注记);页顶状态卡 = Cookie 池(脱敏 ttwid 前缀 + 导入/清空)+ 网关健康(/health 探测);健康列 = N 连败徽标(last_error);ASR 观测列随解读批后置

## 6. 前台展示

- `/telegram`:独立路由,**混合流**(文字电报 + 视频解读卡同流,媒体类型筛选:全部/文字/短视频),流式时间轴(今天/昨天分组、相对时间、源渠道 chip、原文外链),**noindex**(robots + X-Robots-Tag)
- **视频电报卡**:竖版封面缩略图(播放按钮/时长角标)+ 平台徽标(抖音/小红书/B站)+ 博主名 + AI 解读摘要 + 关键要点折叠 + 互动数 + 「原视频 ↗」外链 + AI 生成标注(「✦ AI 生成 · 摘要与要点,内容版权归原作者」)
- **版权展示边界**:一律外链跳转原视频,不内嵌/不分发原片;封面仅缩略图;解读内容显著标注 AI 生成
- 「我的关注」置灰 chip(三期多租户轻入口,不实现操作)
- 实时感:KISS 起步 = 前台 30-60s 轮询 `GET /api/telegrams?since=&media=`(公开缓存短 TTL);SSE 仅在轮询体验不足时升级
- 首页 Hub 控制台化:hero 控制台(Agent 搜索输入框 + 建议词 chips)+ 电报流 LIVE 带(文字/短视频混排,视频行含小封面/平台徽标/博主/时长)+ 项目展示 + 博主文章(「博主个人」渠道标识)多区一体(requirement §4「首页 Hub 控制台化」);任一区数据源不可用时其余区正常渲染

## 7. 立项结论与待明确

**已定(2026-10-03,M7 文字管道立项;实测 = 从生产服务器直连验证)**:

- **首批渠道**:量子位(RSS `https://www.qbitai.com/feed`,实测 175 可达 0.2s/条目有效)+ 机器之心(官方 token 鉴权 RSS `https://mcp.applications.jiqizhixin.com/rss`,MCP 应用端点;免费档实测限 1 次/60min,适配器对 HTTP 429 特判——供应方限频不记失败只顺延下轮;token 存 `crawl_source.config`,**后台配置管理,不走环境变量**——2026-10-03 用户定)。频控按渠道独立:`crawl_interval_min` + `daily_max_requests`(机器之心 60min/日 25 次起步)。备选池(HN hnrss.org 可分数过滤/arXiv cs.AI/Solidot 均 175 可达,MIT-TR/Verge AI 备选)。**一期弃:Reddit(175 直连超时被墙)、X(API 付费制且不可达)**。
- 前台实时感:终选 **30-60s 轮询**(SSE 不做)。
- 首页电报 LIVE 带随 M7 一并接入。
- LLM 摘要:一期先规则截断,LLM 摘要作后置增强开关(选型评审后开)。
- 电报流进站点内容 MCP 只读工具集:随专项 K3 一并交付,M7 不做。
- AI 内容合规口径(2026-09-30 评估结论沿用):「✦ AI 生成」标注已定,电报流预生成摘要不触发备案义务。

**待明确(随②短视频解读立项时回答)**:

- **视频博主首批名单与平台顺序**。~~2026-09-30 合规评估曾建议 B 站优先~~ → **2026-10-04 用户定调:抖音优先,M8 立项交付**(签名/TLS 指纹/Cookie 风控这套最难基建打通后,B 站开放生态只需轻适配器;反之不成立)。合规评估结论仍然成立并已内化为交付边界:全链路唯一实质法律风险点在抖音无水印下载(平台 ToS + 规避技术措施/反不正当竞争,有抓取判例)——故 M8 走「listing 元数据 + 外链」保守模式(§3.2 注记:play_url 不落库不下载,不做 ASR),无水印下载与解读待博主书面授权后独立立项。首批博主名单随真机验证补充(登记入口 admin/bloggers 已就绪)。参考实现:`ai-invest-assisstant` 项目 2026-09-22 前实战有效的 signer/transport/cookies,已平移为 `douyin-gateway/`
- **ASR 供应商选型与成本实测**(云 ASR vs 本地 whisper;单条成本 × 日量估算,验证 $5/日预算护栏)。**成本锚点(2026-09-30 评估)**:录音文件识别腾讯云 ¥1.75/小时(每月 5h 免费额度)、阿里云 ¥2.50/小时;起步场景(约 10 条/日 × 4 min)月增 ~¥0-40,受 $5/日护栏钉住的硬上限 ~¥1100/月,预期 ¥50-300/月;服务器零增量(interpreter 同机 worker,见 §3.2 资源约束)
- LLM 摘要/解读模型选型(成本 vs 摘要质量;结构化输出 schema 评审)。单条成本上限随选型锁定(2026-09-30 评估:每条转写 2-3k tokens 入 + 0.5k 出 ≈ 0.5-5 分)
- 版权投诉与下架通道的运营口径(入口位置/响应时效/留痕要求;机制已进 §4)
- **多租户演进(三期)**:`social_account` 加 user 维度(每用户自选博主)的数据隔离、采集去重(同一博主多人关注时解读结果共享)与成本配额模型;博主条目更新通知机制(是否有「新解读」提醒)
