-- M58 批③:榜单时序(leaderboard_snapshot)
-- 每日一抓,同一 (source, board, entity_key, captured_date) 幂等覆盖;
-- 名次变动不落库,读侧与上一可用日期比较得出(data-expansion-plan §6.2)。
CREATE TABLE "leaderboard_snapshot" (
    "id" BIGSERIAL NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "board" VARCHAR(40) NOT NULL,
    "entity_key" VARCHAR(200) NOT NULL,
    "entity_name" VARCHAR(300) NOT NULL,
    "entity_type" VARCHAR(12) NOT NULL,
    "vendor" VARCHAR(60),
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION,
    "score_unit" VARCHAR(20),
    "captured_date" DATE NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaderboard_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_leaderboard_snapshot"
    ON "leaderboard_snapshot"("source", "board", "entity_key", "captured_date");
CREATE INDEX "idx_leaderboard_snapshot_board"
    ON "leaderboard_snapshot"("source", "board", "captured_date" DESC);
