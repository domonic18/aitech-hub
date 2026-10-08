/**
 * 前台注册页(M21 批⑤,提案 §8):用户名+邮箱+密码 → 验证邮件(D1:
 * 注册→认证→登录;短信通道三期,运营商个人签名资质停发)。
 */
import type { Metadata } from "next";

import SiteRegisterForm from "@/components/auth/SiteRegisterForm";

export const metadata: Metadata = {
  title: "注册",
  alternates: { canonical: "/register" },
};

export default function RegisterPage(): React.ReactElement {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold text-text-1">注册</h1>
      <SiteRegisterForm />
    </section>
  );
}
