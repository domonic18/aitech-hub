-- M49 批X1:渠道扩展数据列(xiaohongshu 起非微信渠道的渠道特有数据走 JSON;
-- wechat 既有类型化列保留不动,零数据搬迁零回归)。forward-only,可空无默认,零锁风险。
ALTER TABLE "publish_channel" ADD COLUMN "data" JSONB;
