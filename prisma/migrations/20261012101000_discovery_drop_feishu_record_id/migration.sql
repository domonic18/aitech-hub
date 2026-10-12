-- M25 发现候选去飞书耦合(2026-10-12 拍板):数据唯一真相源在本系统,
-- 外部分发(如飞书选题库)后续经 MCP 接口由 Claude Code 打通,系统内不耦合。
-- feishu_record_id 失去唯一写入方,列移除(如未来外部同步需要回写标记,
-- forward-only 重加即可)。
ALTER TABLE "discovery_candidate" DROP COLUMN "feishu_record_id";
