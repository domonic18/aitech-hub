# 数据源设计(占位)

> 状态:占位骨架(2026-09-30 建立)。需求明确后补充细化;本文只锚定定位、已知事实与待明确问题,不写实现细节。

## 1. 定位

定义本站内容的全部来源渠道、各渠道接入方式与数据去向;与 [02-data-collection.md](./02-data-collection.md)(采集执行)、[03-data-model.md](./03-data-model.md)(落地模型)衔接。

## 2. 已知数据源

- **legacy WordPress(已完成,2026-09-29)**:154 篇原创 + 296 用户 + 媒体引用闭包,迁移 verify 七条全 PASS(验收基准 requirement §7;迁移设计文档已删除,细节见 git 历史)。生产库实跑留待 M6 切换(standard/02-cicd-deployment §5 runbook)
- **人工创作(一期)**:后台编辑器一键发文 + 发布 API / 创作 MCP(requirement §3.6)
- **未来**:多渠道采集(→ 02-data-collection)、AI 生成(→ 04-ai-agent)

## 3. 待明确(细化时回答)

- 各渠道统一接入契约:raw → clean → publish 管线是否泛化 WP 迁移的 extract/transform/load 模式
- 源数据去重与溯源字段规范(wp_*_id / sha1 模式如何泛化)
- 二期资讯源清单、优先级与合规边界
