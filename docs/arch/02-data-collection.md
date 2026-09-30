# 数据采集设计(电报流)

> 状态:概要设计(2026-09-30,随「电报流」需求细化立此存照;二期立项时评审后再实现)。
> 需求基准见 [requirement/01-requirement.md §4](../requirement/01-requirement.md)「电报流(AI 资讯产品化)」;UI 原型:[site-telegram](../prototypes/site-telegram.html) / [admin-telegram](../prototypes/admin-telegram.html) / [admin-spider](../prototypes/admin-spider.html)。

## 1. 定位与产品形态

**电报流** = 站内短讯流产品:后台 spider 定时爬取 AI 相关资讯渠道,清洗过滤后生成 1-3 句摘要"电报",前台以实时感方式滚动展示,让用户感知「有 AI 在实时获取互联网 AI 资讯」。它是 requirement §1「不追资讯量、做可信信息源」的资讯侧落法:**短、少、准,人设是"站长的 AI 信息触达回路",不是资讯站**。

与旧 3314 条弃用资讯的本质区别(旧站教训的制度化):

| | 旧资讯(fat-rat-collect) | 电报流 |
|---|---|---|
| 内容形态 | 整文入库,伪装文章 | 1-3 句摘要 + 原文外链 |
| 存储 | WP posts 表,与文章混排 | 独立 `telegram` 表,不进文章库 |
| SEO | 被搜索引擎收录,低质拖累全站 | `/telegram` 路由 **noindex**,不进 sitemap/RSS |
| 准入 | 爬到即发 | 规则过滤 + 屏蔽词 + 去重,默认从严 |

## 2. 数据模型锚点(终态字段草案,实现时进 arch/03 + Prisma migration)

- `crawl_source` 渠道表:`id / name / type(rss|web|api) / url / enabled / crawl_interval_min / last_run_at / next_run_at / status(healthy|degraded|error) / 备注`
- `telegram` 电报表:`id / source_id / title / summary(1-3 句) / url(原文外链) / published_at(源发布时间) / content_hash(去重,sha1(title+url 规范化)) / status(visible|hidden|archived) / filter_hit(命中的过滤规则,nullable) / created_at`
- `blocklist` 屏蔽词表:`id / word / scope(title|summary|all) / hit_count / enabled / created_at`
- 过滤规则一期内置代码级启发(广告特征、标题党、编码异常),不做规则表;命中统计写 `telegram.filter_hit` 供后台观测

## 3. 采集管道(worker,BullMQ `crawler` 队列)

```
调度器(per-source interval)→ 渠道适配器(Crawlee;RSS 直接 parse)
  → 清洗(正文/标题抽取、HTML 剥离、长度截断)
  → 过滤(广告/低质启发式 → filter_hit 标记,默认不Visible)
  → 屏蔽词命中 → 同上
  → content_hash 去重(命中即丢弃)
  → LLM 摘要(可选,二期评审;先规则截断)→ 入库 status=visible
```

- 频控:每渠道独立 `crawl_interval_min`(默认 ≥30min),对目标站遵守 robots.txt 与 UA 规范
- 失败处理:连续失败 ≥3 次 → source.status=error 并在采集后台标红;不阻塞其他渠道
- 队列复用 arch/05-services §4 二期任务划分;抖音等签名渠道复用 Python signer sidecar(research/01)

## 4. 治理(后台 admin/telegram)

- **CRUD**:列表(筛选:渠道/状态/日期/关键词)+ 编辑(标题/摘要)+ 隐藏/恢复 + 归档 + 删除(软删)
- **过滤观测**:进流数 / 过滤拦截数 / 屏蔽词命中数,按日聚合
- **屏蔽词管理**:增删改 + 命中计数;新增屏蔽词可选"回溯隐藏存量命中"
- **归档与清理**:`visible` 超过 N 天(默认 90)自动转 `archived`(BullMQ daily 任务);archived 不在前台展示;清理 = archived 超 M 天物理删除,后台手动触发 + 确认弹窗

## 5. 采集管理后台(admin/spider)

- **渠道管理**:上表字段可视化,启停、编辑 interval、立即重跑
- **采集日历**:月网格,按日聚合采集量(分渠道色阶),点日查看当日渠道分解——回答"哪天采了什么、哪个渠道断了"
- **采集器状态可视化**:worker 心跳与存活、`crawler` 队列深度(completed/failed/active/delayed)、各渠道最近 24h 采集条带图、最近错误列表——数据全部来自 BullMQ 队列 API 与 crawl_source/telegram 聚合,不引第三方监控

## 6. 前台展示

- `/telegram`:独立路由,流式时间轴(今天/昨天分组、相对时间、源渠道 chip、原文外链),**noindex**(robots + X-Robots-Tag)
- 实时感:KISS 起步 = 前台 30-60s 轮询 `GET /api/telegrams?since=`(公开缓存短 TTL);SSE 仅在轮询体验不足时升级
- 首页 Hub 化:首页嵌电报流 band(最新 N 条 + LIVE 指示 + 「进入电报流」),与项目展示、博客三区一体(requirement §4「首页 Hub 化」);任一区数据源不可用时其余区正常渲染

## 7. 待明确(二期立项时回答)

- 渠道清单与优先级(候选:机器之心/量子位/HN/Reddit r/MachineLearning/X 学者账号/RSS 聚合)
- LLM 摘要是否引入(成本 vs 摘要质量;先规则截断跑通)
- 电报流是否进站点内容 MCP 只读工具集(倾向进,与「给人也给智能体」一致)
- 轮询 vs SSE 终选
