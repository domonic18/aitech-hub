-- M30 批②:topic 绑定写作 skill——agent 合成写稿时按 topic.skill_key 取
-- agent_skill 指南(写前必取,写法随 skill 变)。可空 = 未绑定;soft ref
-- 不设 FK(skill 删除后引用随删降级为无 skill,应用层取不到即回落)。

ALTER TABLE "topic" ADD COLUMN "skill_key" VARCHAR(50);
