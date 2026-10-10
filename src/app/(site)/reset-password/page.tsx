/**
 * 重置密码页(2026-10-09 验收反馈问题1):邮件链接落地(?token= 一性次令牌)
 * → 设置新密码。缺 token 直接给无效提示态,不发无效请求。
 */
import type { Metadata } from "next";
import Link from "next/link";

import ResetPasswordForm from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = {
  title: "重置密码",
  alternates: { canonical: "/reset-password" },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold text-text-1">重置密码</h1>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="flex w-full max-w-sm flex-col items-center gap-4">
          <p className="rounded-sm border border-line bg-panel-2 px-3 py-2 text-center text-xs text-text-2">
            链接无效:缺少重置令牌,请从邮件里的链接进入本页。
          </p>
          <Link href="/forgot-password" className="text-xs text-accent hover:underline">
            重新发送重置邮件
          </Link>
        </div>
      )}
    </section>
  );
}
