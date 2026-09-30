# 数据采集设计(占位)

> 状态:占位骨架(2026-09-30 建立)。需求明确后补充细化。

## 1. 定位

多渠道内容采集(spider/爬虫)架构:渠道适配、调度、清洗入库、频控与合规。承接 development-plan §3 二期「AI 资讯管道」。

## 2. 已有决策锚点

- 技术预案:Crawlee + BullMQ `crawler` 队列(arch/05-services §4 二期任务)
- 抖音渠道签名:复用 Python signer sidecar(结论见 [../research/01-douyin-signer-eval.md](../research/01-douyin-signer-eval.md))
- **旧站教训**:3314 篇爬虫资讯已弃用(301 至 /articles 承接)——重做采集必须先解决「低质内容拖累 SEO」问题,采集 ≠ 直接发布

## 3. 待明确(细化时回答)

- 渠道清单与优先级(资讯源 / 公众号 / 社媒?)
- 内容准入标准:人审 vs 自动分级,与 SEO 策略的联动
- worker 队列划分与频控(与 arch/05-services §4 衔接)
