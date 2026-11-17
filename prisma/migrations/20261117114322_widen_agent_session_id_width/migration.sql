-- 放宽会话 id 列宽:search_agent_session.id varchar(36) → varchar(40)
--
-- 根因(2026-11-17):会话 id 有两种形态——成员 = uuid(36),游客 = "g_"+uuid(38,
-- kind 标记前缀,isGuestThreadId 据此判别)。列宽按 uuid 的 36 定,游客行
-- upsert(touchGuestSessionAfterRun)必然超长失败 → 游客会话行从未落库
-- (后台「会话管理」游客行恒空)、游客的 tokens_total 累计也不落库
-- (会话累计闸对游客实际不生效)。
--
-- user_token_ledger.session_id 同宽:它是 search_agent_session.id 的 FK
-- (onDelete SetNull),Prisma 要求 relation 两侧 native type 一致,否则建不了
-- relation(standard/03-db-naming §5)。两侧一并放宽,登记见 §7.4。
--
-- 列参与 PK/FK,故按 Prisma 口径先摘约束再改类型再挂回;纯放宽(varchar
-- typmod 变化),不丢数据、可从零重放。

-- DropForeignKey
ALTER TABLE "user_token_ledger" DROP CONSTRAINT "user_token_ledger_session_id_fkey";

-- AlterTable
ALTER TABLE "search_agent_session" DROP CONSTRAINT "search_agent_session_pkey",
ALTER COLUMN "id" SET DATA TYPE VARCHAR(40),
ADD CONSTRAINT "search_agent_session_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "user_token_ledger" ALTER COLUMN "session_id" SET DATA TYPE VARCHAR(40);

-- AddForeignKey
ALTER TABLE "user_token_ledger" ADD CONSTRAINT "user_token_ledger_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "search_agent_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
