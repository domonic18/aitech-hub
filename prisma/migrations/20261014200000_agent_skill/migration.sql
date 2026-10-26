-- M30 批①:agent_skill 表——业务流程纪律(写作指南、分发流程等知识型扩展)
-- 从 agent 系统提示提取为可管理资产:后台建改即时生效零发版,agent 写前经
-- 统一两工具渐进披露取用(批② 接线:list 元数据先行、get 按需全文)。
-- forward-only;种子数据走 prisma/seed.ts(幂等 upsert,不覆盖后台后续编辑),
-- 不入迁移。

CREATE TABLE "agent_skill" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "scenario" VARCHAR(200) NOT NULL,
    "guide_md" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_skill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_agent_skill_key" ON "agent_skill"("key");
