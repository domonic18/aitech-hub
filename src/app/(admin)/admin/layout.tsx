import type { Metadata } from "next";

import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminSprite from "@/components/admin/AdminSprite";
import AdminTopbar from "@/components/admin/AdminTopbar";
import { maskPhone } from "@/lib/auth/mask";
import { requireAdminPage } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "admin",
  robots: { index: false, follow: false },
};

/** admin 壳层(DESIGN-SPEC §3/§5):requireAdminPage 守卫 + 220px 侧栏 + crumb 顶栏 */
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
      <AdminSidebar />
      <div style={{ marginLeft: "var(--admin-sidebar-w)" }}>
        <AdminTopbar nickname={user?.nickname ?? null} phone={maskPhone(user?.phone)} />
        <main className="px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
