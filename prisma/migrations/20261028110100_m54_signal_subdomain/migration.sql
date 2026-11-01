-- M54:信号子域列(tech 子域分类落库;词表 insight_taxonomy.parent 关联)
ALTER TABLE "insight_signal" ADD COLUMN "subdomain" VARCHAR(30);
