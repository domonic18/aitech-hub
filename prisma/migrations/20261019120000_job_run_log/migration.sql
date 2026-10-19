-- 任务运行台账(验收二批③):周期/手动批任务持久运行记录,单一写入口 worker 分发器包装
CREATE TABLE "job_run" (
    "id" BIGSERIAL NOT NULL,
    "job_key" VARCHAR(60) NOT NULL,
    "queue" VARCHAR(40) NOT NULL,
    "job_name" VARCHAR(60) NOT NULL,
    "trigger" VARCHAR(10) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_job_run_recent" ON "job_run"("started_at" DESC);
CREATE INDEX "idx_job_run_key_recent" ON "job_run"("job_key", "started_at" DESC);
