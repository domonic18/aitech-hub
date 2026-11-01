-- M51 公众号排版增强选项:段落排版(镜像 doocs isUseIndent/isUseJustify)+ 文首阅读时间/目录卡
ALTER TABLE "publish_wechat_config" ADD COLUMN "para_style" varchar(20) DEFAULT 'default' NOT NULL;
ALTER TABLE "publish_wechat_config" ADD COLUMN "enable_toc_meta" boolean DEFAULT false NOT NULL;
