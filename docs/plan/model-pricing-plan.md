# 模型牌价 · 按量比价(开发计划)

> **状态:批 A 已合入 develop(PR #257);批 B1(PR #258)/B2(PR #259)/B3(火山引擎)已实现;批 B4(词元所)挂起待裁定**。立项 2026-11-15(站长新增需求 6 条),里程碑 [M74](development-plan.md#2-里程碑)。
> 需求基准:[requirement/01-requirement.md §4](../requirement/01-requirement.md)。
> 本文是**过程文档**(方案 + 批次计划 + 待裁定),不是终态方案——实现落码后按批回写
> [arch/03](../arch/03-data-model.md) §2.4 / [arch/01](../arch/01-data-source.md) §4 / [arch/05](../arch/05-services.md) §4 / [arch/07](../arch/07-frontend.md),本文压缩为一行基线后删除。
> 分支纪律:每批一个 `feature/m74-*` 分支 → PR 合 `develop`,`main` 禁直推(根 CLAUDE.md §3)。
> **本文不提交 git**(过程文档,站长自留工作区)。

---

## 1. 背景与现状核对

### 1.1 需求还原(站长原话 → 功能点)

| # | 站长原话 | 拆解后的功能点 |
|---|---|---|
| R1 | 做一个强大的爬取和显示各个模型价格的页面,方便用户查询**全网最便宜的模型提供方和价格** | 比价页是主诉求:同一模型跨提供商可比、最低价可定位;「全网」含聚合平台(不只官方一手价) |
| R2 | 爬虫已覆盖 coding plan / token plan,但**按量调用**对应页面还没上线,爬取结果还比较简单 | 补**按量(pay-as-you-go)模型牌价**面:现役按量面只有 DeepSeek / Kimi 两家;解析只有单一 input/output 两价 |
| R3 | 对国内主流模型提供商的模型及价格**爬取、入库、清理、去重、展示** | 五段流水线:采集 → 入库 → 清理(下线/失效) → 去重(同模型多来源) → 展示 |
| R4 | 目前已实现的渠道是通过 openrouter,不是国内主要用户使用 → 增加国内主流提供商:**百炼、腾讯云、火山引擎、硅基流动、百度词元所** | 5 个新增按量牌价源 |
| R5 | 对最终收集的模型情况要有**可视化视图**进行查看和筛选 | 现只有「厂商多选 × 价格区间」两个维度;需补可视化与多维筛选 |
| R6 | 对目前**免费使用的模型**要有标识,方便快速找到免费模型、提供商及源页面 | 免费布尔标识 + 前台「只看免费」快捷筛选 + 行级源页面外链 |

### 1.2 现状核对(事实,含一处与初始认知的出入)

**出入**:需求描述里「目前已经实现的渠道是通过 openrouter」与代码现状不符——OpenRouter 通道在
2026-10-29「批 B」已砍除(`prisma/schema.prisma:1613` 注释:「非刚需;其产出行已清」),
现役 8 个牌价源**全部是国内厂商**。但站长的直觉方向是对的:**国内主流厂商的覆盖确实不够,
缺的是「按量调用」这一面**,不是「套餐面」这一面。这条差异决定了下面全部范围。

| 面 | 现役源(`src/lib/pricing/source-registry.ts:75-181`) | 状态 |
|---|---|---|
| **按量模型牌价**<br>`model_pricing` | `deepseek`、`moonshot` | **仅 2 家**;解析简单——单一 input/output 两价,无阶梯、无缓存价、无模态计价(schema 注释自述「时段折扣与缓存价 v1 不收」) |
| **订阅套餐**<br>`coding_plan` | `kimi-membership`、`minimax-mplan`、`tencent-tokenplan`、`xiaomi-mimo`、`bailian-token`、`glm-coding` | 6 家;**百炼与腾讯云已有套餐面**,按量面缺 |
| 免费标识 | `free_tier` 自由文本 | 采集器**不采**该字段(`ModelPrefillRow` 无此字段),只能人工录入;**无布尔标识、无筛选** |
| 前台 | `/pricing/` 单页(模型区 + 套餐区),`src/components/site/pricing/`(8 组件 1032 行) | 筛选仅「厂商多选 × 价格区间」两维;套餐对比托盘(≤4)有、**模型跨厂商比价无**;无可视化;无免费标识 |
| 采集底座 | `crawl_source` type=pricing + `crawler-tick` 通用调度 + `SourceCapture` 快照档案 | 复用现成基建;周级周期(`PRICING_CRAWL_INTERVAL_MIN = 10_080`);失败自动标「待复核」 |
| 分发入口 | `src/lib/telegram/ingest.ts:17` 按 `crawl_source.type` 路由到 `runPricingSourceCrawl` | 新源注册即接入,零新管线 |
| 后台 | `/admin/pricing` 双页签(`ModelsBoard` / `PlansBoard`),行内改价 / 启停 / 状态筛选 | 源维护归「数据中心·源管理」(`channel-ledger.ts:88` `pricingRows`);无批量审核、无归并、无免费标记 |

**结论**:R2/R3/R4 是同一件事的三种说法——**按量模型牌价面的国内厂商覆盖**;R1/R5/R6 是这一面的
展示层升级。范围据此重新划定(§2)。

## 2. 范围

**目标**

1. 国内主流厂商的**按量模型牌价**系统化采集,覆盖 ≥5 家新增源 + 现有 2 家解析升级;
2. 价格结构从「两价」升级到能承载**阶梯价 / 缓存价 / 峰谷价 / 模态计价**;
3. 厂商与模型**归一**,使「同一模型跨提供商比价」成立;
4. 前台比价页支持**可视化 + 多维筛选**,用户能定位「最便宜的提供方」;
5. **免费模型可一键筛出**,每行带官方源页面外链;
6. 采集到的脏数据(下线模型 / 重复行 / 失效价格)有明确清理口径。

**非目标(本期不做)**

- 不做海外厂商(OpenAI / Anthropic / Google 等)——「全网」是否含海外见 §6 第 10 条;
- 不做账号体系、报价推送、订阅告警、价格预测;
- 不做多币种结算、不代购、不撮合交易;
- 不复用洞察域实体表硬套牌价语义(理由见 §3.4)。

## 3. 数据模型改造(草案,待 §6 裁定后定稿)

### 3.1 现有表的承载力缺口

`model_pricing`(`prisma/schema.prisma:1614-1636`)现有 12 个业务列,逐条对照真实定价形态:

| 缺口 | 现实中的形态 | 影响 |
|---|---|---|
| G1 厂商是自由文本 | 各源各写(「阿里云百炼」「百度词元所」「腾讯云」…) | 筛选与聚合不可靠;跨源无法按厂商合并 |
| G2 价格只有两列 | 阶梯价(千问按上下文分档)、缓存价(DeepSeek/Qwen context cache)、峰谷价(部分厂商时段)、模态计价(图像按张 / 视频按秒 / 音频按分钟) | **R2「爬取结果还比较简单」的根因**;阶梯价会被压成一个数 = 谎话 |
| G3 无「完全免费」标识 | 「价=0」与「有免费额度」是两回事 | R6 落不了地 |
| G4 无能力维度 | 模态 / 上下文长度 / 是否推理模型 | R5 没有筛选维度可给 |
| G5 `model_key` 未归一 | `qwen3-235b-a22b` vs `Qwen/Qwen3-235B-A22B` vs `…-instruct` | 同一模型跨厂商聚不起来 = 比价做不成 |
| G6 无价格变更史 | 用户关心「降了多少」 | 本期列为可选批 F |
| G7 无下线墓碑 | 源停止提供的模型会永久残留 | R3「清理」无落点 |

### 3.2 新增表(草案)

> **批 A 已落地,实际形态与本节草案有出入(以 arch/03 §2.4 为准)**:
> 表名按 `standard/03`「同一功能族沿用主实体前缀」落 `model_pricing_provider` /
> `model_pricing_model` / `model_pricing_tier`(不是草案里的 `pricing_*`);
> `model_pricing` 的厂商引用落 **`provider_id`(bigint FK,SetNull)**,不是草案里的
> `provider_key` 字符串列(§3 「外键列 `<被引实体>_id`」纪律);
> `modality` 只落**模型字典**、不落牌价行(避免双写),上下文长度按行给(各家截断不同)。

**`model_pricing_provider`(厂商字典 / 归一层)**

| 列 | 类型 | 说明 |
|---|---|---|
| `key` | varchar(30) 唯一 | 规范键(`aliyun-bailian` / `tencent-cloud` / `volcengine-ark` / `siliconflow` / `baidu-ciyuansuo` / `deepseek` / `moonshot` …) |
| `name` | varchar(60) | 展示名 |
| `display_order` | int | 前台排序 |
| `region` | varchar(10) | cn / intl |
| `source_kind` | varchar(20) | `official`(官方一手)/ `aggregator`(聚合平台,如词元所、硅基流动) |
| `homepage_url` | varchar(300) | 厂商入口 |
| `status` | varchar(10) | enabled / disabled |

**`model_pricing_model`(模型字典 / 跨厂商归一层)**

| 列 | 类型 | 说明 |
|---|---|---|
| `model_key` | varchar(120) 唯一 | 规范键(如 `qwen3-235b-a22b`) |
| `match_key` | varchar(120) 唯一 | 归一锚(分隔符/大小写/前缀归一后),去重锚 |
| `display_name` | varchar(120) | 展示名 |
| `family` | varchar(60) | 产品线(`qwen3` / `deepseek-v3` / `glm-4` / `doubao-seed`) |
| `modality` | varchar(30) | text / text+vision / image / audio / video / embedding / rerank |
| `status` | varchar(10) | enabled / disabled |

> 上下文长度**不落本表**:各家截断不同(同一模型在官方与聚合平台给的上下文不一样),
> 按行给在 `model_pricing.context_window`——所以批 A 的实际表**没有** `context_window` 列。

**`model_pricing_tier`(价格档位,行价 → 档位价)**
| 列 | 类型 | 说明 |
|---|---|---|
| `model_pricing_id` | bigint FK | → `model_pricing` |
| `tier_label` | varchar(60) | 档位名(`≤32k` / `缓存命中` / `峰段 09:00-23:00` / `默认`) |
| `input_price` / `output_price` / `cache_price` | decimal(12,4)? | 该档位单价;null = 该档不适用 |
| `min_tokens` / `max_tokens` | int? | 阶梯边界(闭开区间口径) |
| `unit` | varchar(20) | `per_1m_tokens` / `per_1k_tokens` / `per_image` / `per_second` / `per_minute` |
| `currency` | varchar(8) | 随价格走(沿用现口径) |
| `data_as_of` / `source_url` / `note` | | 档位级溯源 |

唯一键 `(model_pricing_id, tier_label)`;索引 `(model_pricing_id)`。

### 3.3 `model_pricing` 增列(批 A 已落地)

| 增列 | 类型 | 用途 |
|---|---|---|
| `provider_id` | bigint? FK→`model_pricing_provider`(`SetNull`,索引) | G1 归一 |
| `model_id` | bigint? FK→`model_pricing_model`(`SetNull`,索引) | G5 跨厂商关联(可空:未归一的行不阻塞) |
| `is_free` | boolean default false(索引) | G3/R6:**所有档位价均为 0** 才为真(与 `free_tier`「有免费额度」语义分离) |

存量兼容:`vendor` 保留不改名(前台与后台都在用),`provider_id` 过渡期可空——
存量行由一次性脚本回填,**认不出的厂商留 null 并在报告里点名**(猜错厂商比不归一更糟)。
`modality` 不落行上(只落模型字典,避免双写);唯一键 `(vendor, model_key)` 暂不改
(改则影响采集侧 upsert 口径,待 §6 第 4 条 + 批 B 一并裁)。

### 3.4 为什么模型归一不直接复用 `insight_entity`

`insight_entity`(`arch/03` §2.4)已是「实体主表 + 别名表」,语义是**厂商事件**(发布/调价/开源)、
面向时间线;牌价要的是**价格语义 + 能力标签 + 档位结构**,字段诉求不同,强耦合会让两边互相拖累。
**倾向:牌价域自建 `model_pricing_model`,但归一规则与
`normalizeEntityKey`(`src/lib/insight/vendor/contract.ts:179`)保持同一套口径**,避免两套归一规则漂移。

## 4. 采集与展示设计

### 4.1 源清单与实探清单(R4)

**接入纪律**:每个源先实探可达性(静态可取 / 需 headless / 需登录态),不凭假设——
沿用 [arch/01](../arch/01-data-source.md) §5 待探清单纪律与 §4 接入契约
(`crawl_source` type=pricing 由系统注册表登记,后台不可手工新建)。

**实探结论(2026-11-15,逐源实测)**——「静态」= 直接 fetch 拿到 HTML 即可解析,
**渲染**= 必须走 card-renderer(headless):

| key | 厂商 | 页面形态 | 取数通道 | 实探结论 | 状态 |
|---|---|---|---|---|---|
| `siliconflow-model` | 硅基流动 | `/pricing` div 网格(非 <table>) | **静态** | 820KB HTML 价直接落 DOM;行容器 class 含 `min-h-[48px]`+`grid`,模型 id 在 `a[title]`;**有时段定价**(格内「费用发生时段: 0点～2点/8点～24点」,2点～8点 是优惠窗)+ 输入/输出/缓存三列 | ✅ 批B1 已落 |
| `tencent-hunyuan` | 腾讯云混元 | 定价文档两张表 | **静态** | 「产品名\|免费额度」+「产品名\|刊例价(每 百万 tokens)」;刊例价格形如「输入:0.5元输出:2元」 | ✅ 批B1 已落 |
| `bailian-model` | 阿里云百炼 | `/zh/model-studio/billing` | **静态**(ICE 载荷) | 价在 `window.__ICE_PAGE_PROPS__` 的 `content` HTML 里;**80 种表头、159 张价格表**——列语义随表而变(模型 ID / 服务部署范围 / 模式 / Token 阶梯 / 输入·缓存·输出单价 / 免费额度)。**多模态表是「多级表头 + 模态子维度」(4 列表头 6 格数据行),按列序映射会错位取价(把「音频输入价」当输出价)** → 设「整表行列对齐闸」:数据行格数与表头列数不一致的表**整体不收**(宁可少收不可错收)。对齐表 70 张/207 行/72 个模型 | ✅ 批B2 已落 |
| `volcengine-ark` | 火山引擎方舟 | `/docs/ark/model-pricing` | **渲染** | 静态 HTML 1.8MB 里 0 处价格(表是客户端渲染)。渲染后结构:章节标题是 `data-leaf="true"` 行内节点(「在线推理（常规）」「在线推理（低延迟）」「在线推理（低优）」「批量推理」),**价格格只有数字**(单位在表头格「元/M token」);同一模型多行=**输入长度阶梯**(阶梯行模型格为空→继承上一行);条件列还可能是**时段**(空闲/高峰) | ✅ 批B3 已落 |
| `baidu-ciyuansuo` | 百度词元所 | SPA(首页 + /model-market) | **渲染** | 渲染后首页有价但**是「模型分组起价」**:卡片 `article.te-card` 给厂商 + 模型组(如 DeepSeek 卡的 `title` 含 3 个模型)+ 「6 家供应商」+ **起价**(输入 1.3 / 输出 ¥1.56 元/百万tokens)——**起价归属组内哪个模型不确定**,直接落库即错价;/model-market 列表页渲染后 **0 处「元/百万」**(价格列疑为接口懒加载,需逆向前端请求)。**另需裁定 3**(挂牌价与官方一手价的关系) | ⏸ 挂起(批B4):来源页与口径均需先定 |
| `deepseek`(改造) | DeepSeek | 静态 | 静态 | 峰谷×缓存矩阵**已升级为档位**(6 档:缓存命中×谷/峰 + 输入×谷/峰 + 输出×谷/峰);行价仍是「高峰·未命中」基准 | ✅ 批B1 已落 |
| `moonshot`(改造) | 月之暗面 | SSR | 静态 | SSR 行只有输入/输出两价,无档位维度;行价口径不变,仅补归一/免费字段 | ✅ 批B1 已落 |

**渲染通道白名单**:批B1/B2 落的三源都是静态取数,**不需要 headless**;批B3 的火山/词元所需把
`www.volcengine.com` / `cysuo.com` 加进 compose 的 `RENDER_ALLOWED_HOSTS`
(与 `src/lib/pricing/render-fetch.ts` 文件头注的两处同步关系同源)。

**百炼的「部署范围」维度**:同一模型按部署地(全球 / 中国内地 / 美国 / 国际)有不同价,
这是**价格维度不是不同模型** → 落档位(档位标签 = 部署范围·模式·Token 区间);
行价取「全球」档作基准价(与「多时段价取最高」同一原则:行价是基准价,不是最便宜那档)。

**词元所的特殊性**(需求点名的「百度最新上线的词元所」):2026-11-12 百度世界大会发布的
大模型交易平台(`cysuo.com`),定位是**模型交易与比价市场**——发布首日申请入驻供应商超 100 家、
汇集 42 款大模型,支持多模型比价、一键切换与存证。它与前四家的性质不同:

- 前四家是**厂商一手价**(自卖自定价);
- 词元所是**第三方供应方的挂牌报价**,同一模型可能有多个供应方给出不同价。

它对 R1(找全网最便宜提供方)价值最高——是唯一能一次拿到「同一模型 × 多供应方报价」的数据源;
但落库口径(供应方 = 厂商?还是聚合平台下的二级供应方?一手价与挂牌价谁覆盖谁?)需先裁定(§6 第 3 条)。

### 4.2 落库与清理口径(R3)

| 场景 | 处置 |
|---|---|
| 同厂商同模型重复采集 | upsert(现规则);`is_pinned=true` 的行采集不覆盖(M73 闸) |
| 同模型跨厂商 | **不去重**,保留多行——比价的前提;靠 `model_pricing_model` 关联 |
| 同厂商同模型、不同来源页(官方页 vs 聚合平台) | **一手优先**:`source_kind=official` 覆盖 aggregator 同模型行;两者并存则按 §6 第 3 条裁定 |
| 源上已下线/不再提供的模型 | **墓碑**:连续 N 轮采集未见 → `status=disabled` + `note=源已下线`(不物理删,历史行可溯) |
| 价格未公布 | `null`,**禁填 0**(沿用现纪律);`null` 不进任何价格区间档(现 `inPriceBand` 已如此) |
| 币种 | 随价格走,原币直出(现 D4 口径);折算见 §6 第 2 条 |

### 4.3 前台 `/pricing/`

现状:单页两段(模型区 + 套餐区),组件在 `src/components/site/pricing/`。

| 新增能力 | 说明 |
|---|---|
| 按量模型面升为主视图 | 需求核心;套餐面降为次要区(路由形态见 §6 第 1 条) |
| **跨厂商比价矩阵** | 行 = 归一后的模型,列 = 提供商,格 = 输入/输出价,**最低价高亮**,点击展开该模型的档位明细与源页面链接 |
| **可视化** | 散点图(X=输入价,Y=输出价,点=厂商×模型)直观看「便宜象限」;厂商维度价格分布条。技术沿用 `/leaderboards/` 的零 JS SVG 范式(M63 已有先例),避免引图表库(首屏性能 + SEO + KISS) |
| **多维筛选** | 在现有「厂商多选 × 价格区间」之上补:模态 / 上下文长度区间 / 免费开关 / 提供商类型(一手 vs 聚合)/ 币种;排序补「输入价」「输出价」 |
| **免费标识(R6)** | 行级「免费」角标(与「有免费额度」文案区分)+ 筛选条「只看免费」快捷 chip + 免费模型聚合视图 + 每行「官方价格页 ↗」外链 |
| 溯源 | 每行显示 `data_as_of`;沿用 45 天过期提醒(现 `PRICING_STALE_DAYS`) |

**币种**:现口径「原币直出不折算」,但「全网最便宜」必须跨币种可比 → 折算与否见 §6 第 2 条。
M63 已有每日汇率(`site_config`)可复用。

### 4.4 后台 `/admin/pricing`

| 新增 | 说明 |
|---|---|
| 批量审核 | 采集落 `pending`,后台批量「通过 → enabled」;现为逐行编辑 |
| 归并视图 | 同模型多行(跨厂商/跨来源)的归一映射编辑,`model_pricing_model` 关联 |
| 免费标记 | 行级 `is_free` / `free_tier` 覆写与置顶 |
| 源健康度 | 各源最近成功/失败时间、待复核行数、失败原因(现散在 `crawl_source` 与日志里) |
| 档位编辑 | tier 行内编辑(阶梯/缓存/峰谷) |

源本身(URL / 启停 / 周期)仍归「数据中心·源管理」——**不新开页面**,沿用 `crawl_source` 体系。

### 4.5 批 E 专属:聚合平台报价的二级建模

若 §6 第 3 条裁定「一手价与挂牌价并存」,词元所的一行牌价实际是
`(平台=词元所, 供应方=第三方 A, 模型=X, 价=Y)` —— 比 `model_pricing` 现有 `(vendor, model_key)`
多一个供应方维度。落法草案:

- `model_pricing_provider` 增加二级行:`source_kind=aggregator` 且 `parent_provider_key` 指向平台自身;
- `model_pricing` 增加 `seller_name?` 列(仅 aggregator 行有值,表示挂牌供应方);
- 前台比价矩阵的「提供商列」在 aggregator 行下按供应方展开。

**此批单独排期**——不依赖它,R1–R6 的其余部分都能独立交付。

---

## 5. 开发计划(主体)

### 5.0 批次总览

| 批 | 主题 | 依赖 | 产出 | 分支 |
|---|---|---|---|---|
| **A** | 数据底座(归一层 + 档位表 + 免费标识列) | §6 第 4/5/7 条裁定 | 3 表 + 3 列 + 迁移 + 存量回填 | `feature/m74-pricing-schema` |
| **B1** | 采集扩容·一(落库改造 + 2 静态新源 + DeepSeek 档位升级) | A | 硅基流动/腾讯云接入 + 归一/档位/免费/墓碑落库 | `feature/m74-pricing-sources` |
| **B2** | 采集扩容·二(百炼) | B1 | 百炼按量牌价接入(ICE 载荷 + 异构表对齐闸) | `feature/m74-pricing-sources-2` |
| **B3** | 采集扩容·三(火山引擎) | B2 | 渲染型源接入 + headless 白名单 | `feature/m74-pricing-sources-3` |
| **B4** | 采集扩容·四(百度词元所) | B3 + 裁定 3 | 聚合平台挂牌价(来源页与供应方口径待定) | `feature/m74-pricing-sources-4` |
| **C** | 免费标识与筛选维度 | A(B 产数据) | 免费角标 + 六维筛选 + URL 同步 + 后台批量终审 | `feature/m74-pricing-free-filter` |
| **C2** | 策展台增强(余项) | C | 源健康度卡 + 档位编辑 | `feature/m74-pricing-console` |
| **D** | 比价矩阵与可视化 | B + C | 比价视图 + 散点 + 排序 | `feature/m74-pricing-compare` |
| **E** | 词元所聚合报价 | A + B(词元所源) + §6 第 3 条 | 二级供应方建模 + 聚合视图 | `feature/m74-pricing-aggregator` |
| **F** | 价格变更史(可选) | A | `model_pricing_change` + 降价视图 | `feature/m74-pricing-history` |

**每批通用收尾(§5.7)**与**每批文档同步清单(§9)**同样适用。
A → B → D 是主链;C 可与 B 并行;E 独立;F 可随时插。

### 5.1 批 A · 数据底座

**目标**:把「厂商 / 模型 / 价格结构 / 免费」四个维度从自由文本升级为可查询的结构,
让后续采集与比价有稳定落点。**本批不改任何现有采集行为**——存量行口径不变。

**状态:已完成(2026-11-15)**。前置裁定按 §6 建议执行:第 4 条建厂商字典表、
第 5 条自建模型字典表、第 7 条完全免费与有免费额度两个标识分开。

**schema 变更**(迁移 `20261115114118_m74_pricing_schema`,已评审并应用):

- 新表 `model_pricing_provider` / `model_pricing_model` / `model_pricing_tier`(§3.2)
  —— 命名与索引遵 [standard/03-db-naming](../standard/03-db-naming.md):表名带域前缀、
  `@unique`/`@@unique`/`@@index` 必带 `map`、FK 列必配索引、`SetNull` 列可空;
- `model_pricing` 增列 `provider_id` / `model_id` / `is_free`;
- `model_pricing` 新增索引 `idx_model_pricing_provider_id` / `idx_model_pricing_model_id` /
  `idx_model_pricing_free`。

**任务清单**

| # | 任务 | 文件 | 状态 |
|---|---|---|---|
| A1 | Prisma 模型与迁移 | `prisma/schema.prisma`、`prisma/migrations/20261115114118_m74_pricing_schema/` | ✅ |
| A2 | 厂商种子(10 家) | `src/lib/pricing/provider-registry.ts` 常量 + `syncPricingProviders` 幂等种入(worker 启动) | ✅ |
| A3 | 归一规则(模型键 / 厂商键 / 产品线) | `src/lib/pricing/normalize.ts`——`normalizeModelKey` / `normalizeMatchKey` / `deriveFamily`,口径对齐 `src/lib/insight/vendor/contract.ts:179` 的 `normalizeEntityKey` | ✅ |
| A4 | 归一解析(get-or-create + 唯一冲突回读) | `src/lib/pricing/model-registry.ts` | ✅ |
| A5 | 档位读写(整档替换 / 批量读) | `src/lib/pricing/tiers.ts` | ✅ |
| A6 | 免费语义判定(纯函数) | `src/lib/pricing/rules.ts`(`isFreePrices` / `isFreeTiers`) | ✅ |
| A7 | 存量回填(一次性脚本,dry-run 默认,幂等) | `scripts/oneoff/m74-pricing-backfill/run.ts` | ✅ |
| A8 | 读侧扩展 | `src/lib/pricing/read.ts`、`public.ts`(`PublicModelRow` 增 `isFree` / `providerKey` / `providerName` / `modelDictKey` / `modality` / `tiers`) | ✅ |

**测试**

- `src/lib/pricing/normalize.test.ts`——归一单测钉死样例表(含 `Qwen/Qwen3-235B-A22B`、
  `gpt-4o-2024-08-06`、`deepseek-flash` 等真实脏样本);
- `src/lib/pricing/rules.test.ts`——完全免费判定(缺价不当免费);
- `src/lib/pricing/provider-registry.test.ts`——vendor 字符串 → 规范键映射;
- `src/lib/pricing/model-registry.test.ts`——get-or-create 幂等 + 并发唯一冲突回读 + 种子只补缺;
- `src/lib/pricing/tiers.test.ts`——整档替换与批量读;
- 回填脚本实跑:5 行模拟存量(同厂商两种写法 + 认不出的厂商)→ 归一正确 + 二次跑零写入。

**完成标准核对**

| 标准 | 结果 |
|---|---|
| 迁移从零重放通过 | ✅ 空库全量 deploy → 二次 deploy 幂等 → `migrate diff --exit-code` = No difference detected |
| 回填脚本重跑零副作用 | ✅ 第二次 apply 回写 0 个字段 |
| 存量行全部带上厂商归一 | ⚠️ **认不出的厂商保持 null 并在报告里点名**(设计如此,不猜) |
| 现有 8 源采集行为不变 | ✅ 批 A 未触碰采集侧(collect/crawlers/source-registry 零改动) |
| 门禁 | ✅ typecheck / lint / test:unit(2265 passed,1 个与本次无关的 WP fixture 超时用例放宽后绿)/ build 绿 |

### 5.2 批 B · 采集扩容(拆 B1 / B2)

**目标**:把按量模型牌价面从 2 家扩到 7 家,并让解析结果承载阶梯/缓存/峰谷/模态。

**前置**:批 A 落库。

**B1(本轮,已实现)**——落库改造 + 两个结构干净的静态源 + DeepSeek 档位升级:

| # | 任务 | 文件 | 状态 |
|---|---|---|---|
| B1-1 | 逐源**实探**(静态 / headless / 需登录态)并记录结论 | 实探结论入 §4.1;robots 与 UA 规范一并核对 | ✅ |
| B1-2 | 落库改造:档位写入 + `is_free` 判定 + 归一关联 + 免费额度原文 | 新建 `src/lib/pricing/model-persist.ts`(从 crawlers.ts 拆出,避开 350 行上限) | ✅ |
| B1-3 | 旧源解析升级到档位结构 | `src/lib/pricing/crawlers.ts`(`parseDeepseek` 出 6 档;`parseMoonshot` 无档位维度) | ✅ |
| B1-4 | 硅基流动解析器 | `src/lib/pricing/model-sources/siliconflow.ts` + golden 样本 | ✅ |
| B1-5 | 腾讯云混元解析器 | `src/lib/pricing/model-sources/tencent.ts` + golden 样本 | ✅ |
| B1-6 | 注册新源 + 采集周期分档(模型面日级 / 套餐面周级) | `source-registry.ts` + `src/lib/collect/constants.ts` | ✅ |
| B1-7 | 墓碑机制(多轮未见 → disabled + 「源已下线」注记) | `model-persist.ts#markMissingModelsStale`;3 天未刷新即墓碑(人工定稿行不参与) | ✅ |
| B1-8 | 免费额度原文入 `free_tier` | 行类型加 `freeTier`,落库写入(与 `is_free`「完全免费」两种语义) | ✅ |

**B2(本轮,已实现)**——百炼(异构表):

| # | 任务 | 文件 | 状态 |
|---|---|---|---|
| B2-1 | ICE 载荷取 content + 表头关键词映射列语义 | `src/lib/pricing/model-sources/bailian.ts` | ✅ |
| B2-2 | **整表行列对齐闸**(多模态多级表头整表排除,不错位取价) | 同上 | ✅ |
| B2-3 | 三维度落档位(部署范围 · 模式 · Token 阶梯)+ 行价取「全球」基准价 | 同上 | ✅ |
| B2-4 | 免费额度原文入 `free_tier` | 同上 | ✅ |
| B2-5 | 注册源 + golden 样本(4 张表:带范围/带免费额度/简单表/多模态排除用例) | `source-registry.ts` + `__fixtures__/bailian-billing.html` | ✅ |

**C(批C:免费与筛选,已实现)——前台可见的那一批**:

| # | 任务 | 文件 | 状态 |
|---|---|---|---|
| C1 | 行级「免费」角标(完全免费,与「有免费额度」分开标) | `ModelSection.tsx` | ✅ |
| C2 | 「只看免费」快捷 chip(带免费行计数) | `FilterBar.tsx` | ✅ |
| C3 | 六维筛选:厂商 × 价格区间 × 免费 × 模态 × 上下文长度 × 来源类型 | `public.ts` 纯函数 + `ModelFilters.tsx`(折叠在 `<details>` 里,首屏不被撑满) | ✅ |
| C4 | 排序(输入价/输出价/模型名;null 价恒排最后) | `public.ts#sortModelRows` | ✅ |
| C5 | 每行「官方价格页 ↗」外链 | 既有 `OfficialLink` | ✅(原已具备) |
| C6 | 筛选态同步 URL(v/b/free/mod/ctx/src/sort;可分享/可后退) | `lib/pricing/query.ts` + `PricingExplorer.tsx`;静态页 `useSearchParams` 须包 Suspense 边界 | ✅ |
| C7 | 后台:批量终审(采集落 pending,不批量通过就永远不上架)+ 免费标记覆写 | `POST /api/pricing/models/bulk` + `ModelsBoard.tsx` | ✅ |
| C8 | 后台:源健康度卡 | — | ⬜ 批C2 |

**批C 顺带修掉一个既有 bug**(M74 批C 实测发现,非本批引入):zod v4 的 `.partial()` **挡不住
`.default()`**——`modelPricingUpdateSchema = create.partial()` 会给缺省键补上默认值,
于是「只改价格」的 PUT 把 `status` 打回 pending(已上架的行从前台消失)、`currency` 重置 CNY、
`is_pinned` 定稿闸被清掉(采集随即覆盖该行)。修法:create 与 update **各写一份契约**,
update 全部 optional 且**无 default**(回归测试锁在 `admin.test.ts`)。

**C2(下一轮)**——策展台余项:源健康度卡(各源最近成功/失败/待复核行数)、档位编辑
(阶梯/缓存/峰谷的手工订正入口)。

**B3(已实现)**——火山引擎方舟(渲染源):

| # | 任务 | 文件 | 状态 |
|---|---|---|---|
| B3-1 | headless 白名单加 `www.volcengine.com` | `docker-compose.prod.yml` `RENDER_ALLOWED_HOSTS` | ✅ |
| B3-2 | 渲染通道取数(静态只有导航壳,必须 headless) | `model-sources/volcengine.ts#fetchVolcengineArk` | ✅ |
| B3-3 | 解析:章节标题(推理场景)→ 档位维度 + 输入长度阶梯 + 缓存命中价 | 同上 | ✅ |
| B3-4 | 行价取「在线推理（常规）」+ 最小输入长度档(常态价) | 同上 | ✅ |
| B3-5 | golden 样本(三场景表格)+ 单测 | `__fixtures__/volcengine-ark-pricing.html` | ✅ |

核对:doubao-seed-2.0-pro 三档 3.2/4.8/9.6、2.1-lite 常规 0.8/2.7 vs 低延迟 1.6/5.4 vs 低优 0.4/1.35、
seed-evolving 6/30 —— 与页面原值一致。

**B4(挂起)**——百度词元所:

| # | 阻塞点 | 说明 |
|---|---|---|
| B4-1 | **价格归属不明** | 首页卡片给的是「模型分组起价」(一张 DeepSeek 卡的 title 含 3 个模型),起价属于组内哪个模型无法确定 → 直接落库即错价 |
| B4-2 | **列表页拿不到价** | `/model-market` 渲染后 0 处「元/百万」,价格列疑为接口懒加载,需逆向前端请求 |
| B4-3 | **口径待裁定** | 挂牌价与官方一手价的关系(§6 第 3 条)+ 二级供应方建模(§4.5) |

→ B4 需先定 ①取数来源(哪个接口/页面给「模型 × 供应方 × 价」)②落库口径(供应方怎么建模)
③裁定 3,再开工。

**测试**

- `src/lib/pricing/model-persist.test.ts`——落库三规则 + 归一 id + 免费标识 + 档位写入 + 墓碑;
- `src/lib/pricing/model-sources/{siliconflow,tencent}.test.ts`——各源一份离线 golden 样本
  (样本落 `src/lib/pricing/__fixtures__/`,自真实页面裁剪);
- `src/lib/pricing/source-registry.test.ts`——周期分档断言(模型面 1440 / 套餐面 10080)。

**完成标准(B1)**:两个新源各 ≥1 次成功采集并抽样人工核对;DeepSeek 档位 6 条落库;
归一 id 写到位;墓碑演练(把某行 dataAsOf 改旧 → 下轮被停用);门禁全绿。

### 5.3 批 C · 免费标识与筛选维度

**目标**:R6 落地,并把 R5 的筛选维度补齐到「厂商 / 模态 / 上下文 / 价格区间 / 免费 / 来源类型」。

**前置**:批 A(列与字典)、批 B(有真实数据可筛)。

**任务清单**

| # | 任务 | 文件 |
|---|---|---|
| C1 | 前台行级免费角标 + 「有免费额度」文案区分 | `src/components/site/pricing/ModelSection.tsx` |
| C2 | 「只看免费」快捷 chip | `src/components/site/pricing/FilterBar.tsx` |
| C3 | 扩展筛选维度(模态 / 上下文区间 / 来源类型 / 币种) | `FilterBar.tsx` + `src/lib/pricing/public.ts` 的纯函数(与现 `filterPricingRows` 同构,补参数) |
| C4 | 排序(输入价 / 输出价) | `public.ts` + `PricingExplorer.tsx` |
| C5 | 每行「官方价格页 ↗」源页面外链 | `ModelSection.tsx`(`sourceUrl` 已有,补展示) |
| C6 | 筛选态 URL 参数化(可分享/可回退) | `PricingExplorer.tsx` + `src/app/(site)/pricing/page.tsx` |
| C7 | 后台:免费标记覆写 + 批量审核 | `src/components/admin/pricing/ModelsBoard.tsx`、`src/app/api/pricing/models/route.ts` |
| C8 | 后台:源健康度卡 | `ModelsBoard.tsx`(读 `crawl_source` type=pricing 行) |

**测试**:`public.ts` 纯函数补测(每维度组合的筛选真值表)、API Zod 契约补测。

**完成标准**:免费模型可一键筛出且角标正确;筛选组合正确;筛选态可分享链接。

### 5.4 批 D · 比价矩阵与可视化

**目标**:R1 + R5 落地——用户能一眼看出「哪个模型、哪个提供方最便宜」。

**前置**:批 B(数据量)+ 批 C(筛选维度)。

**任务清单**

| # | 任务 | 文件 |
|---|---|---|
| D1 | 比价矩阵组件(行=归一模型,列=提供商,最低价高亮) | 新建 `src/components/site/pricing/CompareMatrix.tsx` |
| D2 | 档位明细展开(点击单元格看阶梯/缓存/峰谷) | `CompareMatrix.tsx` + `shared.tsx` |
| D3 | 散点图(输入价 × 输出价,零 JS SVG) | 新建 `src/components/site/pricing/PriceScatter.tsx`;范式抄 `/leaderboards/` 的 `ModelBoard.tsx` 零 JS 悬停卡 |
| D4 | 厂商价格分布条 | `PriceScatter.tsx` 内或独立组件 |
| D5 | 比价视图与现有「套餐对比托盘」的关系(共用/并存) | `CompareTray.tsx` 调整 |
| D6 | 币种折算(若 §6 第 2 条裁定折算) | `public.ts` 折算纯函数 + 复用 `site_config` 汇率 |
| D7 | SEO:比价视图的 JSON-LD 扩充 | `public.ts` 的 `buildPricingJsonLd` |
| D8 | 大列表性能(行数上限 / 虚拟化评估) | `PricingExplorer.tsx` |

**测试**:散点/矩阵的纯计算函数(分桶、坐标映射、最低价判定)补单测;
`public.ts` 的折算函数补测(汇率缺失 → 不折算,保持原币,不得静默按 1:1)。

**完成标准**:同一模型跨 ≥2 提供商并排比价、最低价高亮正确;散点图在窄屏可读;
零 JS 悬停卡可用;页面 ISR 与首屏体积无明显劣化(`npm run build` 产物对比)。

### 5.5 批 E · 词元所聚合报价

**目标**:让「同一模型 × 多供应方挂牌价」可采集、可展示——R1 的极致形态。

**前置**:批 A + 批 B(词元所源接入)+ §6 第 3 条裁定。

**任务清单**

| # | 任务 | 文件 |
|---|---|---|
| E1 | 词元所页面实探(动态程度 / 是否需 headless / 数据接口) | 结论回填 §4.1 |
| E2 | 二级供应方建模 | `model_pricing_provider` 加 `parent_provider_key`;`model_pricing` 加 `seller_name?` |
| E3 | 解析器 | `src/lib/pricing/model-sources/baidu-ciyuansuo.ts` |
| E4 | 聚合视图(按供应方分组的报价列表) | `src/components/site/pricing/AggregatorQuotes.tsx` |
| E5 | 前台标注区分(「官方一手价」vs「平台挂牌价」) | `ModelSection.tsx` / `CompareMatrix.tsx` |

**完成标准**:词元所挂牌价与官方一手价在页面上可区分、可并存;同一模型多家供应方报价可排序。

### 5.6 批 F · 价格变更史(可选)

`model_pricing_change`(model_pricing_id / old_input / old_output / new_input / new_output /
changed_at / source)+ 落库时对比现值写变更行 + 前台「降价了」视图。
**收益**:站点内容差异化(价格变动是高频 AI 资讯题材);**成本**:额外表 + 对比逻辑 + 视图。

### 5.7 每批通用门禁

1. `npm run typecheck && npm run lint && npm run test:unit` 全绿,**且 `npm run build` 绿**
   —— tsc/lint 查不出 route 导出白名单类错误,改路由后本地必须补跑 build;
2. schema 有变更:`npx prisma migrate dev --create-only` 生成 SQL → **人工评审** →
   **从零重放验证**(前向 only,禁改已应用迁移);
3. 测试分层遵 [standard/01-testing](../standard/01-testing.md);解析器必配 golden 单测
   (arch/01 §4 质量门:解析器配 golden 单测,单源失败只影响自身健康度);
4. 行为变更同批更新对应 arch 章节(见 §9),不允许代码先行、文档后补;
5. 分支 `feature/m74-*` → PR 合 `develop`;合并前 CI 绿;
6. 收尾自查:文件 ≤350 行;`src/lib/pricing/public.ts` 保持**零库依赖**(prerender-safe / 无 env),
   客户端组件只引纯函数那半(2026-11-01 曾因 env 打进 client chunk 致浏览器白屏)。

---

## 6. 待裁定项(需站长拍板,影响 schema 与范围)

> 第 4/5/7 条已按「建议」执行(批 A 落地,2026-11-15):厂商与模型各建字典表、
> 「完全免费」与「有免费额度」两个标识分开。其余待拍板——**第 1/2/3 条卡批 D/E**,
> 第 6/8/9/10 条卡对应批次开工前。

| # | 议题 | 选项 | 建议 | 状态 |
|---|---|---|---|---|
| 1 | 页面形态 | (A) `/pricing/` 单页 tab(URL 参数化)(B) 新路由 `/pricing/models/` + `/pricing/plans/` | **A**:比价页要做深筛选,URL 参数化是必需的;独立路由会让 SEO 链接碎片化 | 待定(卡批 D) |
| 2 | 币种折算 | (A) 沿现口径原币直出 (B) 统一折算人民币(可切换) | **B**:R1「找最便宜」跨币种不可比的;复用 M63 汇率 | 待定(卡批 D) |
| 3 | 词元所报价与官方一手价的关系 | (A) 并列展示(标注「聚合平台挂牌价」) (B) 官方优先、聚合仅补缺 (C) 聚合价单独一区 | **A**:挂牌价与一手价都是真实可买到的价格,标注来源即可;这也是「全网最便宜」的核心信息 | 待定(卡批 E) |
| 4 | 厂商归一形态 | (A) 建 `model_pricing_provider` 表 (B) 只加 `provider_key` 列 + 前台常量字典 | **A**:后台要维护厂商官网与排序,常量字典改一次要发版 | **已按 A 落地** |
| 5 | 模型归一形态 | (A) 自建 `model_pricing_model` (B) 复用 `insight_entity` | **A**(理由见 §3.4) | **已按 A 落地** |
| 6 | 采集周期 | (A) 周级(现) (B) 日级 (C) 模型面日级 / 套餐面周级 | **C**:按量价变动敏感,套餐价稳定 | 待定(卡批 B) |
| 7 | 「免费」语义 | (A) 只做完全免费 (B) 完全免费 + 有免费额度两个标识 | **B**:R6 两条都要,但必须分开标注,不能混成一个「免费」角标 | **已按 B 落地**(`is_free` 布尔 + `free_tier` 原文) |
| 8 | 下线模型处置 | (A) 连续 N 轮未见自动 disabled (B) 留后台人工 | **A** + 保留人工覆盖入口 | 待定(卡批 B) |
| 9 | 可视化技术 | (A) 零 JS SVG(复用 M63)(B) 引图表库 | **A**:首屏性能 + SEO + 无新依赖 | 待定(卡批 D) |
| 10 | 是否收录海外厂商 | (A) 只做国内 (B) 国内 + OpenAI/Anthropic/Google 等 | **B**(若「全网」按字面):海外源多走官方 API/静态页,采集成本低,但会引入汇率与口径问题——依赖第 2 条裁定 | 待定(卡批 B) |

## 7. 风险与合规

- **robots / UA**:只取公开价格页,不模拟登录、不绕过风控;遵守各站 robots.txt 与 UA 规范
  (沿用 arch/01 §4 合规口径);
- **动态页渲染**:硅基流动 / 词元所可能需 headless —— `render-fetch` 白名单
  (`src/lib/pricing/render-fetch.ts`)与 compose 层 `RENDER_ALLOWED_HOSTS` 需两处同步
  (注册表文件头注已写明这条同步关系);
- **页面改版**:每次采集的原文 + 截图由 `SourceCapture` 落私有桶、`crawl_snapshot` 记结论,
  改版当天回溯(现成能力,沿用);
- **不臆测**:未公布价格留 `null`,不填 0;无法判定免费不标 `is_free`;
- **价格免责**:页面上需注明「数据截至 X,实际以官方页面为准」+ 每行源页面外链;
- **爬虫礼仪**:官方牌价页礼貌采集,周期不短于日级(批 B 裁定后确定),遵守各站频控;
- **词元所性质**:聚合平台挂牌价 ≠ 厂商承诺价,前台必须显著区分,避免用户误当官方价。

## 8. 验收标准

1. 5 个新增源各 ≥1 条按量模型牌价落库,抽样与官方页面口径一致(人工核对);
2. 阶梯 / 缓存 / 峰谷 / 模态计价不再被压成单一数字,档位结构可展示;
3. 同一模型跨 ≥2 提供商可并排比价,最低价高亮正确;
4. 免费模型可一键筛出,行级有「免费」标识、提供商名、官方源页面外链;
5. 多维筛选(厂商 / 模态 / 上下文 / 价格区间 / 免费 / 提供商类型)组合正确;
6. 源失败自动标「待复核」且不阻塞其他源;采集台账记 `pricing.curated_persisted` tally;
7. 源下线模型有墓碑处置,不永久残留;
8. `npm run typecheck && npm run lint && npm run test:unit` 全绿 + **`npm run build` 绿**;
9. 迁移从零重放通过(前向 only,禁改已应用迁移);
10. 每一批的 arch 同步已落(§9)。

## 9. 文档同步清单(每批收尾)

| 批 | 需同步的文档 | 状态 |
|---|---|---|
| A | `arch/03` §2.4(牌价归一层三表 + 增列 + 落库规则);`standard/03-db-naming` §2(登记 `model_pricing_` 前缀) | ✅ 已同步 |
| B | `arch/01` §4(接入契约)/ §5(实探结论);`arch/05` §4.2(**现无 pricing 任务行**,补采集任务与周期) | 待 |
| C | `arch/07` §1(前台 `/pricing/` 行);根 `CLAUDE.md` 关键约束(如涉及红线) | 待 |
| D | `arch/07` §1 / §2(视图与路由);`arch/03`(若折算落 `site_config` 口径变更) | 待 |
| E | `arch/03` §2.4(二级供应方建模);`arch/01` §4(聚合平台接入口径) | 待 |
| F | `arch/03` §2.4;`arch/07`(降价视图) | 待 |
| 全部 | `development-plan.md` M74 状态行;本文压缩为一行基线后删除(README 纪律 #4) | M74 行已更新;本文在 M74 全部批次落完后压缩 |

## 10. 引用

- 现状实现:`src/lib/pricing/`(注册表 `source-registry.ts` / 模型面 `crawlers.ts` / 套餐面 `plan-sources.ts` /
  落库 `curated-persist.ts` / 渲染 `render-fetch.ts` / 读侧 `read.ts` `public.ts` `admin.ts`),
  `src/components/site/pricing/`、`src/app/(site)/pricing/page.tsx`、`src/components/admin/pricing/`、
  `src/app/api/pricing/{models,plans}/`、分发入口 `src/lib/telegram/ingest.ts:17`、
  台账 `src/lib/collect/channel-ledger.ts:88`、周期常量 `src/lib/collect/constants.ts:56`
- **批 A 新增**:`src/lib/pricing/normalize.ts`(键归一/产品线,纯)、
  `src/lib/pricing/rules.ts`(免费语义,纯)、`src/lib/pricing/provider-registry.ts`(厂商种子与 vendor 映射,纯)、
  `src/lib/pricing/model-registry.ts`(get-or-create + 厂商种子幂等种入)、
  `src/lib/pricing/tiers.ts`(档位读写)、
  `scripts/oneoff/m74-pricing-backfill/run.ts`(存量回填,一次性),
  测试 `src/lib/pricing/{normalize,rules,provider-registry,model-registry,tiers}.test.ts`
- 数据模型:`prisma/schema.prisma`(牌价域三表 + `model_pricing` 增列);
  `docs/arch/03-data-model.md` §2.4「牌价策展域两表」与「牌价归一层三表」
- 接入契约:`docs/arch/01-data-source.md` §4、§5;采集架构 `docs/arch/02-data-collection.md`
- 调度与任务:`docs/arch/05-services.md` §4.2(现**无** pricing 任务行,批 B 补)
- 前台约定:`docs/arch/07-frontend.md` §1;命名规范 `docs/standard/03-db-naming.md`;测试 `docs/standard/01-testing.md`
- 外部事实:百度词元所(cysuo.com,2026-11-12 百度世界大会发布,大模型交易平台 / 比价市场);
  火山引擎方舟模型价格文档;硅基流动模型价格总览
