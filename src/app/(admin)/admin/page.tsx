/**
 * 站点统计概览(M4):真实计数的最小落地;PV/UV 趋势、来源细分、热门页面等
 * 完整形态随 M5 交付(侧栏/页内降级注记,DESIGN-SPEC §6)。
 */
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage(): Promise<React.ReactElement> {
  const [postsTotal, postsPublished, users, media, categories] = await Promise.all([
    prisma.post.count(),
    prisma.post.count({ where: { status: "published" } }),
    prisma.userAccount.count(),
    prisma.media.count(),
    prisma.category.count(),
  ]);

  const kpis = [
    { icon: "i-filetext", label: "文章", value: postsTotal, sub: `已发布 ${postsPublished}` },
    { icon: "i-user", label: "用户", value: users, sub: "继承旧站 296(三期短信登录)" },
    { icon: "i-picture", label: "媒体文件", value: media, sub: "媒体库随 M5 交付" },
    { icon: "i-book", label: "分类", value: categories, sub: "四分类沿用旧站" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-md border border-line bg-panel p-4">
            <div className="mb-2 flex items-center gap-2 text-xs text-text-2">
              <svg className="ic" aria-hidden="true">
                <use href={`#${k.icon}`} />
              </svg>
              {k.label}
            </div>
            <div className="font-mono text-2xl font-semibold">
              {k.value.toLocaleString("en-US")}
            </div>
            <div className="mt-1 text-[11px] text-text-3">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-line bg-panel p-4 text-xs leading-relaxed text-text-2">
        <p className="mb-1 font-medium text-text-1">M4 认证基座已就绪</p>
        <p>
          admin 密码登录 + 会话吊销 + 爆破防护已生效;文章管理、媒体库、完整站点统计(PV/UV 趋势、
          来源细分、热门页面)随 M5 交付,电报流治理与采集后台为二期范围。
        </p>
      </div>
    </div>
  );
}
