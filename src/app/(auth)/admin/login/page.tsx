import type { Metadata } from "next";

import AdminSprite from "@/components/admin/AdminSprite";
import LoginForm from "@/components/admin/LoginForm";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "admin 登录",
  robots: { index: false, follow: false },
};

/** admin 登录页(arch/05-services §3.1):不做会话预判,已登录误入由提交后跳转收敛 */
export default function AdminLoginPage(): React.ReactElement {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-4 text-text-1">
      <AdminSprite />
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm rounded-md border border-line bg-panel p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-block h-4 w-2 bg-accent" aria-hidden="true" />
          <span className="text-base font-semibold">一起AI 控制台</span>
        </div>
        <p className="mb-6 font-mono text-xs text-text-3">$ ssh admin@17aitech.com</p>
        <LoginForm />
      </div>

      <p className="max-w-sm text-center text-[11px] leading-relaxed text-text-3">
        账号由服务器 <code className="font-mono text-text-2">npm run admin</code> 创建; 连续失败 5
        次将锁定 15 分钟。用户短信登录三期开放,当前仅 admin 鉴权。
      </p>
    </div>
  );
}
