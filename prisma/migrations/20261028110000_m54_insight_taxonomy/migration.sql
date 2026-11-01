-- M54 批A:领域词表(领域/子域两层 taxonomy)——分类器(Jev Choice)输出键域
-- 与呈现层领域 chips 的唯一真相源。种子 = 8 领域 + tech 四子域 + 兜底。
CREATE TABLE "insight_taxonomy" (
    "id"         SERIAL        NOT NULL,
    "kind"       VARCHAR(12)   NOT NULL,
    "key"        VARCHAR(30)   NOT NULL,
    "label"      VARCHAR(30)   NOT NULL,
    "parent"     VARCHAR(30),
    "enabled"    BOOLEAN       NOT NULL DEFAULT true,
    "sort_order" INTEGER       NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insight_taxonomy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "insight_taxonomy_key_key" ON "insight_taxonomy"("key");

INSERT INTO "insight_taxonomy" ("kind", "key", "label", "parent", "enabled", "sort_order") VALUES
  ('domain', 'tech',        '科技',   NULL,        true,  10),
  ('domain', 'finance',     '财经',   NULL,        true,  20),
  ('domain', 'politics',    '时政',   NULL,        true,  30),
  ('domain', 'military',    '军事',   NULL,        true,  40),
  ('domain', 'society',     '社会',   NULL,        true,  50),
  ('domain', 'sports',      '体育',   NULL,        true,  60),
  ('domain', 'entertainment', '文娱', NULL,        true,  70),
  ('domain', 'lifestyle',   '生活',   NULL,        true,  80),
  ('domain', 'other',       '其他',   NULL,        true,  90),
  ('subdomain', 'ai-learning',  'AI学习',      'tech', true, 10),
  ('subdomain', 'ai-appdev',    'AI应用开发',  'tech', true, 20),
  ('subdomain', 'ai-drama',     'AI短剧制作',  'tech', true, 30),
  ('subdomain', 'ai-startup',   'AI创业',      'tech', true, 40),
  ('subdomain', 'tech-other',   '科技其他',    'tech', true, 90);
