-- M56 验收反馈:牌价渠道统一并入 crawl_source(type=pricing)维护,
-- pricing_source 独立表退役(渠道数据已由种子迁入 crawl_source)
DROP TABLE "pricing_source";
