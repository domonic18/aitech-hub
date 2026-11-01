-- M56 验收反馈:coding_plan 补 周期价格(季/年)+ 权益详情 + 周期口径说明
ALTER TABLE "coding_plan" ADD COLUMN "quarterly_fee" DECIMAL(12,2);
ALTER TABLE "coding_plan" ADD COLUMN "yearly_fee" DECIMAL(12,2);
ALTER TABLE "coding_plan" ADD COLUMN "billing_note" VARCHAR(120);
ALTER TABLE "coding_plan" ADD COLUMN "benefits" JSONB;
