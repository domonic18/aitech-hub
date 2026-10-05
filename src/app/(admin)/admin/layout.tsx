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
    </div>
  );
}
