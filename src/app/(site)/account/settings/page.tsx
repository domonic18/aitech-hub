/**
 * 个人设置页(M22 批②,需求2/3/10):资料 + 头像 + 密码三卡,M65 P1 增手机号
 * 绑定/换绑卡(admin 不显示——管理员账号禁短信登录)。RSC 守卫走
 * requireAccountPage(M65:JWT 验签 + Redis jti 登记双查,吊销即时生效),
 * 未登录 308 去登录页带 next 回跳。账号中心无 SEO 价值,force-dynamic。
 */
import Link from "next/link";

import AvatarUpload from "@/components/account/AvatarUpload";
import PasswordForm from "@/components/account/PasswordForm";
import PhoneForm from "@/components/account/PhoneForm";
import ProfileForm from "@/components/account/ProfileForm";
import { maskPhone } from "@/lib/auth/mask";
import { requireAccountPage } from "@/lib/auth/guard";
import { getAccountProfile } from "@/lib/users/account-profile";

export const dynamic = "force-dynamic";

export const metadata = { title: "个人设置" };

export default async function AccountSettingsPage(): Promise<React.ReactElement> {
  const session = await requireAccountPage("/account/settings");
  const isAdmin = session.role === "admin";

  const profile = await getAccountProfile(BigInt(session.sub));

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-lg font-bold">个人设置</h1>
      <p className="mt-1 text-xs text-text-3">
        管理昵称、头像、登录密码与手机号;邮箱注册通道资料同源。
      </p>

      <section className="mt-6 rounded-md border border-line bg-panel p-5">
        <h2 className="mb-4 text-sm font-semibold">头像</h2>
        <AvatarUpload nickname={profile.nickname ?? "用户"} avatarPath={profile.avatarPath} />
      </section>

      <section className="mt-4 rounded-md border border-line bg-panel p-5">
        <h2 className="mb-4 text-sm font-semibold">基础资料</h2>
        <ProfileForm nickname={profile.nickname ?? ""} bio={profile.bio ?? ""} />
      </section>

      {!isAdmin && (
        <section className="mt-4 rounded-md border border-line bg-panel p-5">
          <h2 className="mb-1 text-sm font-semibold">手机号</h2>
          <p className="mb-4 text-xs text-text-3">
            手机号可用于验证码登录;更换手机号需先验证当前号码。
          </p>
          <PhoneForm maskedPhone={profile.phone ? maskPhone(profile.phone) : null} />
        </section>
      )}

      <section className="mt-4 rounded-md border border-line bg-panel p-5">
        <h2 className="mb-1 text-sm font-semibold">登录密码</h2>
        {profile.hasPassword ? (
          <div className="mt-3">
            <PasswordForm />
          </div>
        ) : (
          <p className="mt-2 text-xs text-text-3">
            该账号尚未设置密码(历史迁移用户),请通过
            <Link href="/forgot-password" className="mx-1 text-accent hover:underline">
              忘记密码
            </Link>
            链路设置后再在此修改。
          </p>
        )}
      </section>
    </div>
  );
}
