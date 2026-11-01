-- M50 批E':pay_gateway_config.app_secret 同列密文升级(e1: 前缀 AES-256-GCM)
-- 密文(base64(iv|tag|ct))较明文膨胀 ~1.4×,varchar(128) 对 >64 字符密钥会溢出,
-- 放宽至 255(纯加宽,forward-only 无锁风险;email_config.password 原生 255 免改)
ALTER TABLE "pay_gateway_config" ALTER COLUMN "app_secret" TYPE varchar(255);
