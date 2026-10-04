-- CreateTable
CREATE TABLE "ai_model" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "protocol" VARCHAR(20) NOT NULL,
    "base_url" VARCHAR(500),
    "model_id" VARCHAR(100) NOT NULL,
    "api_key_enc" VARCHAR(500),
    "api_key_mask" VARCHAR(20),
    "purposes" TEXT[],
    "supports_vision" BOOLEAN NOT NULL DEFAULT false,
    "concurrency" INTEGER NOT NULL DEFAULT 4,
    "timeout_sec" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_tested_at" TIMESTAMPTZ(6),
    "last_test_status" VARCHAR(10),
    "last_test_error" VARCHAR(500),
    "last_test_latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_task_binding" (
    "role" VARCHAR(20) NOT NULL,
    "primary_id" INTEGER,
    "backup_id" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_task_binding_pkey" PRIMARY KEY ("role")
);

-- CreateTable
CREATE TABLE "asr_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "provider" VARCHAR(50) NOT NULL,
    "protocol" VARCHAR(20) NOT NULL,
    "base_url" VARCHAR(500),
    "model_id" VARCHAR(100) NOT NULL,
    "api_key_enc" VARCHAR(500),
    "api_key_mask" VARCHAR(20),
    "max_audio_seconds" INTEGER NOT NULL DEFAULT 600,
    "hotwords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_tested_at" TIMESTAMPTZ(6),
    "last_test_status" VARCHAR(10),
    "last_test_error" VARCHAR(500),
    "last_test_latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asr_config_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ai_task_binding" ADD CONSTRAINT "ai_task_binding_primary_id_fkey" FOREIGN KEY ("primary_id") REFERENCES "ai_model"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_task_binding" ADD CONSTRAINT "ai_task_binding_backup_id_fkey" FOREIGN KEY ("backup_id") REFERENCES "ai_model"("id") ON DELETE SET NULL ON UPDATE CASCADE;
