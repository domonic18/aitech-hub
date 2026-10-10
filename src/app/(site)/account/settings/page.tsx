/**
 * 个人设置页(M22 批②,需求2/3/10):资料 + 头像 + 密码三卡。RSC 守卫
 * 同 /pay 惯例(cookies() 裸值 verifyAccessToken 单一契约),未登录 308 去
 * 登录页带 next 回跳。账号中心无 SEO 价值,force-dynamic。
 */
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import AvatarUpload from "@/components/account/AvatarUpload";
import PasswordForm from "@/components/account/PasswordForm";
import ProfileForm from "@/components/account/ProfileForm";
import { ACCESS_COOKIE_NAME } from "@/lib/auth/constants";
import { verifyAccessToken } from "@/lib/auth/session";
import { getAccountProfile } from "@/lib/users/account-profile";

export const dynamic = "force-dynamic";

export const metadata = { title: "个人设置" };

export default async function AccountSettingsPage(): Promise<React.ReactElement> {
  const store = await cookies();
  // 单一契约(session.ts):裸 token 值 + 框架解析(/pay 死循环教训同款注释)
  const session = await verifyAccessToken(store.get(ACCESS_COOKIE_NAME)?.value ?? null);
  if (!session) redirect(`/login?next=${encodeURIComponent("/account/settings")}`);

  const profile = await getAccountProfile(BigInt(session.sub));

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-lg font-bold">个人设置</h1>
      <p className="mt-1 text-xs text-text-3">管理昵称、头像与登录密码;邮箱注册通道资料同源。</p>

      <section className="mt-6 rounded-md border border-line bg-panel p-5">
        <h2 className="mb-4 text-sm font-semibold">头像</h2>
        <AvatarUpload nickname={profile.nickname ?? "用户"} avatarPath={profile.avatarPath} />
      </section>

      <section className="mt-4 rounded-md border border-line bg-panel p-5">
        <h2 className="mb-4 text-sm font-semibold">基础资料</h2>
        <ProfileForm nickname={profile.nickname ?? ""} bio={profile.bio ?? ""} />
      </section>

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
