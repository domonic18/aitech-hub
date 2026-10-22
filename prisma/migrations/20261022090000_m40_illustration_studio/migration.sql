-- 配图工坊三表(M40 批 B,arch/05 §4.7):ai_illu_version(版本链)/
-- ai_illu_layer_group(图层组=一次拆层运行,base_media_path=干净底板)/
-- ai_illu_layer(图层行,bbox normalized 0-999 + 透明 PNG 转存路径)。
-- spike 实证:底板=抠净元素干净底(藏层即元素真消失);图层=bbox 区域
-- 高分重提(尺寸非等比,合成按 bbox 定位缩放);水印烙在底板导出恒带。
-- CreateTable
CREATE TABLE "ai_illu_version" (
    "id" BIGSERIAL NOT NULL,
    "media_path" VARCHAR(500) NOT NULL,
    "parent_version_id" BIGINT,
    "origin" VARCHAR(20) NOT NULL,
    "edit_instruction" VARCHAR(1000),
    "edit_bbox" VARCHAR(40),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_illu_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_illu_layer_group" (
    "id" BIGSERIAL NOT NULL,
    "version_id" BIGINT NOT NULL,
    "base_media_path" VARCHAR(500),
    "status" VARCHAR(12) NOT NULL DEFAULT 'processing',
    "error" VARCHAR(500),
    "model_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_illu_layer_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_illu_layer" (
    "id" BIGSERIAL NOT NULL,
    "group_id" BIGINT NOT NULL,
    "z_index" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "bbox_x1" INTEGER NOT NULL,
    "bbox_y1" INTEGER NOT NULL,
    "bbox_x2" INTEGER NOT NULL,
    "bbox_y2" INTEGER NOT NULL,
    "media_path" VARCHAR(500) NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_illu_layer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_ai_illu_version_parent" ON "ai_illu_version"("parent_version_id");

-- CreateIndex
CREATE INDEX "idx_ai_illu_version_media" ON "ai_illu_version"("media_path");

-- CreateIndex
CREATE INDEX "idx_ai_illu_group_version_created" ON "ai_illu_layer_group"("version_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_ai_illu_layer_group_zindex" ON "ai_illu_layer"("group_id", "z_index");

-- AddForeignKey
ALTER TABLE "ai_illu_version" ADD CONSTRAINT "ai_illu_version_parent_version_id_fkey" FOREIGN KEY ("parent_version_id") REFERENCES "ai_illu_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_illu_layer_group" ADD CONSTRAINT "ai_illu_layer_group_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "ai_illu_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_illu_layer" ADD CONSTRAINT "ai_illu_layer_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "ai_illu_layer_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

