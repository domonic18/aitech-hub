-- M46 验收批:簇舆情倾向 LLM 打标扩展位(词云四色;label.ts 日批回写,
-- null=未打标读侧按中性显示)。可空列零回填零默认,纯加法前滚。
ALTER TABLE "insight_cluster" ADD COLUMN "sentiment" VARCHAR(8);
