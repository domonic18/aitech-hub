import type { Metadata } from "next";

import AdminShell from "@/components/admin/AdminShell";
import AdminSprite from "@/components/admin/AdminSprite";
import { maskPhone } from "@/lib/auth/mask";
import { requireAdminPage } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "admin",
  robots: { index: false, follow: false },
};

/** admin 壳层(DESIGN-SPEC §3/§5):requireAdminPage 守卫 + AdminShell(侧栏/顶栏,M13 抽屉化) */
export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const claims = await requireAdminPage();
  const user = await prisma.userAccount.findUnique({
    where: { id: BigInt(claims.sub) },
    select: { nickname: true, phone: true },
  });

  return (
    <div className="min-h-screen bg-bg text-text-1">
      <AdminSprite />
      <AdminShell nickname={user?.nickname ?? null} phone={maskPhone(user?.phone)}>
        {children}
      </AdminShell>
      {/* 悬浮 AI 助手已上移根 layout(M35 宿主唯一化):admin 会话经
          /api/search/agent 解析 admin 身份档(细粒度生产工具在位),且 run
          跨 admin 路由切换不中断 */}
    </div>
  );
}
