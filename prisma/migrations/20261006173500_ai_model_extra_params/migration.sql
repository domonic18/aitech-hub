-- AlterTable: 供应商扩展参数(M16 验收反馈问题2:生图水印开关等);可空,浅合并进请求体
ALTER TABLE "ai_model" ADD COLUMN     "extra_params" JSONB;
