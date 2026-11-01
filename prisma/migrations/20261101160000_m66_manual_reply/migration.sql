-- 转人工闭环(M66):站长的答复先落在用户行上,用户下次发言时优先投递(认证订阅号
-- 无客服消息权限,只能挤 5s 被动回复窗口,故做成「留言式人工答复」)。
ALTER TABLE "channel_wechat_mp_user"
  ADD COLUMN "manual_reply" TEXT,
  ADD COLUMN "manual_reply_at" TIMESTAMPTZ(6);
