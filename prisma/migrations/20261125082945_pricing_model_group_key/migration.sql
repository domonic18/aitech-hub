-- AlterTable
ALTER TABLE "model_pricing_model" ADD COLUMN     "group_key" VARCHAR(140);

-- CreateIndex
CREATE UNIQUE INDEX "uq_model_pricing_model_group_key" ON "model_pricing_model"("group_key");

