-- CreateTable
CREATE TABLE "stats_region_daily" (
    "stat_date" DATE NOT NULL,
    "country" VARCHAR(64) NOT NULL,
    "province" VARCHAR(64) NOT NULL,
    "pv" BIGINT NOT NULL DEFAULT 0,
    "uv" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "stats_region_daily_pkey" PRIMARY KEY ("stat_date","country","province")
);

