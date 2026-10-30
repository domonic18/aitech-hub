-- M59 批B:实体聚合视图(洞察中心 /admin/insight/entities)
-- 复合索引 (entity_key, occurred_at DESC):列表按 entity_key 分组(前缀可用)+
-- 实体详情 WHERE entity_key = ? ORDER BY occurred_at DESC 单索引直出。
CREATE INDEX "idx_entity_event_entity_recent" ON "entity_event"("entity_key", "occurred_at" DESC);
