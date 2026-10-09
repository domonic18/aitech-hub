-- AlterTable
ALTER TABLE "user_account" ADD COLUMN     "email" VARCHAR(255),
ADD COLUMN     "email_verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "username" VARCHAR(100);

-- CreateTable
CREATE TABLE "user_verification_token" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "purpose" VARCHAR(20) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_verification_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_user_verification_token_user_purpose" ON "user_verification_token"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_account_username" ON "user_account"("username");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_account_email" ON "user_account"("email");

-- AddForeignKey
ALTER TABLE "user_verification_token" ADD CONSTRAINT "user_verification_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

