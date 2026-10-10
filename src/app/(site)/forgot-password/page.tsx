/**
 * 忘记密码页(2026-10-09 验收反馈问题1):提交账号 → 邮箱收重置链接。
 */
import type { Metadata } from "next";

import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "忘记密码",
  alternates: { canonical: "/forgot-password" },
};

export default function ForgotPasswordPage(): React.ReactElement {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-16">
      <h1 className="mb-2 text-2xl font-bold text-text-1">忘记密码</h1>
      <p className="mb-6 text-xs text-text-3">输入注册账号,重置链接将发送到绑定邮箱。</p>
      <ForgotPasswordForm />
    </section>
  );
}
