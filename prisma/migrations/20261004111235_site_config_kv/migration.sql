-- CreateTable
CREATE TABLE "site_config" (
    "key" VARCHAR(50) NOT NULL,
    "value" VARCHAR(200) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_config_pkey" PRIMARY KEY ("key")
);
