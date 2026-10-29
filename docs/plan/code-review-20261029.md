# 代码评估与优化清单(2026-10-29 CodeReview)

> 审查范围:采集类 / 洞察中心 / 数据中心+MCP / 前台组件 / 常量与目录规范。
> 五路并行取证(全部有 file:line 证据)+ M55/M56 新代码一手复盘。
> 本文档 = 评估结论 + 优化追踪清单(逐项销账);完成一项勾一项。

## 总体结论

整体质量高于同类项目平均线,强项在"纪律":cron/队列名/job 名三层真相源+re-export 链完整(全库无内联 cron 字面量)、admin 页面普遍为 26-57 行薄壳、channels API 五路由为全仓一致性最佳样本、洞察批处理自吞异常自愈且 LLM 全走网关零直连、前台组件零状态+props 整行对象。

主要债务集中在两类:**单一真相源执行不彻底**(常量/格式化/组件两三处重复维护)与**平行实现未收编**(三套页签件、两套会话守卫、同构函数双份)。M55/M56 pricing 渠道并入即为反面实证:旁路接入漏 1 处过滤制造用户可见 bug;"新增 source type 改 ~7 处"且无 checklist。

## P0(立即)

- [ ] **P0-1 采集台账牌价渠道双行渲染**:`channels-admin.ts:91` listChannelsAdmin 仅排 social-video,pricing 渠道同时进 rssRows 与 pricingRows(channel-ledger.ts:34),每渠道渲染两行;连带 plan-rows.ts 资讯组、channel-health.ts 误标。
  修:`listChannelsAdmin` 加 `notIn: [SOCIAL_VIDEO, PRICING]`。

## P1(本周)

- [ ] **P1-1 洞察分类批大小被静默覆盖**:`embed.ts:102` 把嵌入批 limit(CLUSTER_BATCH_SIZE=200)透传 runInsightClassify,`CLASSIFY_BATCH_SIZE=50` 被覆盖,单轮最多 200 次串行 Jev 调用。修:编排处对 classify 段单独传 CLASSIFY_BATCH_SIZE。
- [ ] **P1-2 双会话守卫语义差**:`session-guard.ts:15` requireSessionActor 见 Bearer 即 403;`auth/guard.ts:23` requireAdminRequest Bearer 在场仍放行(email-config/pay-config/admin-proxy 用),PAT 搭会话灰面。修:统一 requireSessionActor,收编 requireAdminRequest。
- [ ] **P1-3 前台分页裸 neutral 色**:`site/Pagination.tsx` hover:bg-neutral-100 / bg-neutral-900 等,暗色主题下当前页与背景近同色。修:token 化(accent/panel-2/text-3)。
- [ ] **P1-4 卡片视图丢付费标识**:PostCard.tsx 有 isPurchasable「¥ 付费」徽章,PostCardGrid.tsx 卡片视图无。修:提取共用付费徽章并修齐。

## P2(touch-by-touch 渐进)

### 常量/硬编码
- [ ] **P2-1 DAY_MS/日界收口**:cluster-view.ts:14 本地重定义 DAY_MS、discover.ts DAY_SEC、~19 文件裸写 86_400_000;北京日界 `T00:00:00+08:00` 四处手抄(insight)。修:datetime 导出 DAY_MS(已有)+ todayStart(),消费点收编。
- [ ] **P2-2 情绪词表三处手抄**:label.ts:61/191 手抄 SENTIMENTS 字面量。修:改引 INSIGHT_SENTIMENTS。
- [ ] **P2-3 健康阈值魔数**:channel-ledger-types.ts:73 `fails >= 3` 未引 CRAWL_MAX_CONSECUTIVE_FAILS。
- [ ] **P2-4 周级魔数**:source-registry.ts:158 `10_080` 具名常量。
- [ ] **P2-5 crawL job name 字面量**:channels-admin.ts:226 `"crawl"` 应引 CRAWL_JOB_SOURCE。
- [ ] **P2-6 douyin-gateway 默认 URL 三处重复**:pins/xhs.ts:63/136、distribute/xhs-probe.ts:23。
- [ ] **P2-7 worker 队列策略魔数**:worker/index.ts:67-87 lockDuration/concurrency 内联三元,随 QUEUE_* 同址导出。

### 域归属/封装(采集)
- [ ] **P2-8 CRAWL_SOURCE_TYPE_PRICING 上收 collect 域**:现寄居 telegram/constants,telegram↔pricing 双向依赖。
- [ ] **P2-9 crawlPlanSource 双重分发**:SOURCE_DEFS 已注册 run,crawlPlanSource 内再按 key if/else;删 key 路由。
- [ ] **P2-10 persist 双份泛型化**:persistModelRows/persistPlanRows、markModelSourceStale/markPlanSourceStale 同构复制。
- [ ] **P2-11 debugChannel 对 pricing 恒报错**:明示「pricing 渠道走立即采集」人话错误。
- [ ] **P2-12 新 source type 接入 checklist 落 arch/06**(枚举/分发/台账/健康/Zod 五处)。

### 封装(前端)
- [ ] **P2-13 sprite 公共 symbols**:Admin/Site 两 sprite 15 个 symbol path 重复维护,抽共享模块按域组装。
- [ ] **P2-14 重复 JSX 四类下沉**:要点折叠块×3、NEW/AI 徽章×2、卡 chrome(专题=项目)×2、60s 轮询 hook×2。
- [ ] **P2-15 PricingView 排序口径下沉**:region×currency 权重移 lib/pricing/public。
- [ ] **P2-16 PageHeader 提取**:eyebrow+h1+desc 页头样板两处+archive 变体。

### 域归属/封装(admin)
- [ ] **P2-17 SubTabs 上移 components/admin**(posts 跨域引用);MineGithub 归洞察域目录。
- [ ] **P2-18 三套页签件收编**:AdminTabNav 加 hideOnNoMatch 收编 InsightTopTabs。
- [ ] **P2-19 parseSubTab 助手**:三页 TABS.some 钳制逐字重复。
- [ ] **P2-20 channels API shared.ts**:PAT_DENY×5 + ChannelAdminError→HTTP 映射×4 收口。
- [ ] **P2-21 MineBloggers 纯函数拆件**(相对时刻第三处实现;run-format.ts 误放 components)。
- [ ] **P2-22 insight 概览 Card 提取共享壳件**(341 行胖页压到 ~200)。
- [ ] **P2-23 requireAdminPage 深链回跳**:固定 next=/admin 丢原路径。

### 洞察扩展性
- [ ] **P2-24 源注册表收口单表**:ingest.ts(medium/enabled)与 constants.ts(kind/label)六处,收口 SOURCE_REGISTRY 投影。
- [ ] **P2-25 resolveInsightModel 统一**:三种守卫范式收敛,固化「未绑定=降级跳过」。
- [ ] **P2-26 taxonomy 子域动态判定**:domain==="tech" 硬编码分支 → 按「启用子域数≥2」判定。

## P3(文档化/暂缓)

- [ ] **P3-1 admin.ts×4 命名约定(各域治理台读侧)写进 arch/06**。
- [ ] **P3-2 桌移双渲染(9 处)取舍备注留档,暂不推翻**。
- [ ] **P3-3 MCP 声明式注册留待工具破 10 个;审计日志补 get/list**。
- [ ] **P3-4 trend/trends、hotboard/hot-source 近义双文件合并**(引用面大,单独小批)。

## 亮点(保持)

cron 三层真相源+re-export 链 · admin 薄壳纪律(26-57 行) · channels API 一致性 · 洞察批处理自愈与 LLM 网关零直连 · 前台组件零状态+整行对象 props · taxonomy DB 化含在用守卫 · MCP 壳层定位(鉴权/stateless/文档化)

## 修复批次记录(2026-10-29 全部落地)

- 批A(P0+P1):e984f5cc —— P0-1 台账双行 + P1-1 批大小覆盖 + P1-2 双守卫 + P1-3 分页 token + P1-4 付费徽章
- 批B(P2 常量/采集封装):e359ad28 —— P2-3/4/5/6/8/9/10/11
- 批C(P2 前端):be5d358e(内含)—— P2-14 四类下沉 + P2-15 排序下沉 + P2-16 PageHeader
- 批D(P2 admin/洞察):2ea805c5(内含)—— P2-17/18/19/20/21/22/23/24/25/26
- 专项:978e403e sprite 单源(P2-13);be5d358e 终审即时可见+专题二级菜单+专题页目录化(2026-10-29 晚间验收反馈)
- P3-1/P3-2 已随批D/批C 文档化;P3-3/P3-4 留待(触发条件见清单)
