/**
 * 前台登录页(M21 批⑤,提案 §8):门禁依赖登录态(D1 邮箱通道,批⓪ API
 * 本页落地)。next 回跳参数服务端校验(仅站内绝对路径,防 open redirect)。
 */
import type { Metadata } from "next";

import SiteLoginForm from "@/components/auth/SiteLoginForm";

export const metadata: Metadata = {
  title: "登录",
  alternates: { canonical: "/login" },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<React.ReactElement> {
  const { next } = await searchParams;
  // open redirect 防线:仅接受站内根相对路径(拒 //、/\、外链)
  const nextPath =
    next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold text-text-1">登录</h1>
      <SiteLoginForm nextPath={nextPath} />
      <p className="mt-8 max-w-sm text-center text-[11px] text-text-3">
        登录用于同步付费权益与评论身份;本站不会向第三方共享你的邮箱。
      </p>
    </section>
  );
}
