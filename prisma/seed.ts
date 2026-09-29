import { PrismaClient } from "@prisma/client";

/**
 * 种子数据(02 文档 §1):四分类,幂等 upsert,可反复执行。
 * slug 沿用旧站四分类(3314 篇资讯分类路由由新站承接,内容不迁移);
 * admin 不预置,首次部署用脚本创建(M4 交付)。
 */
const prisma = new PrismaClient();

const CATEGORIES = [
  { slug: "blog", name: "博客文章", description: "AI 工程实战原创文章", sortOrder: 1 },
  { slug: "report", name: "产品评测", description: "AI 产品评测与实测", sortOrder: 2 },
  { slug: "news", name: "行业资讯", description: "AI 行业资讯(旧站内容不再迁移)", sortOrder: 3 },
  {
    slug: "advertising",
    name: "推广活动",
    description: "推广活动(旧站内容不再迁移)",
    sortOrder: 4,
  },
] as const;

async function main(): Promise<void> {
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, description: c.description, sortOrder: c.sortOrder },
      create: c,
    });
    console.log(`seeded category: ${c.slug}(${c.name})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
