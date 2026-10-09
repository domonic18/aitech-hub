-- M21 补齐批:登录可见门禁(仿旧站 unlock_type=1,免费但须登录)
-- 与付费解锁(is_purchasable)互斥,互斥校验在应用层 Zod(superRefine)
ALTER TABLE "content_post"
  ADD COLUMN "is_login_required" BOOLEAN NOT NULL DEFAULT false;
