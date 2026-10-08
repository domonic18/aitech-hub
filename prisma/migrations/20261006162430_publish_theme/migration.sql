-- AlterTable
ALTER TABLE "publish_channel" ADD COLUMN     "theme" VARCHAR(20);

-- AlterTable
ALTER TABLE "publish_wechat_config" ADD COLUMN     "theme" VARCHAR(20) NOT NULL DEFAULT 'default';
