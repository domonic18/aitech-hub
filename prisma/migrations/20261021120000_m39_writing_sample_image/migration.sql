-- 样例参照图库(M39 批③ §13.11):管理员上传的风格参照图绑到专题,
-- 合成生图时以 data URL 传 Seedream image 参数,出图向参照风格靠拢;
-- topic.sample_image_id 为 soft ref(删图库行事务置空,应用层完整性)
CREATE TABLE "writing_sample_image" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "media_path" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "writing_sample_image_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "topic" ADD COLUMN "sample_image_id" BIGINT;
