import { PrismaClient } from "@prisma/client";

/**
 * 种子数据(arch/03-data-model §1):四分类,幂等 upsert,可反复执行。
 * slug 沿用旧站四分类(3314 篇资讯分类路由由新站承接,内容不迁移);
 * admin 不预置,首次部署用脚本创建(M4 交付)。
 * M72 瘦身 B7:agent skill 种子随之退役(`agent_skill` 表已删,指南真相源=
 * 仓库 `skills/writing/*.md`),本文件只管分类种子。
 */
const prisma = new PrismaClient();

const CATEGORIES = [
  {
    slug: "blog",
    name: "博客文章",
    description: "AI 工程实战原创文章",
    isOriginal: true,
    sortOrder: 1,
  },
  {
    slug: "report",
    name: "产品评测",
    description: "AI 产品评测与实测",
    isOriginal: true,
    sortOrder: 2,
  },
  {
    slug: "news",
    name: "行业资讯",
    description: "AI 行业资讯(旧站内容不再迁移)",
    isOriginal: false,
    sortOrder: 3,
  },
  {
    slug: "advertising",
    name: "推广活动",
    description: "推广活动(旧站内容不再迁移)",
    isOriginal: false,
    sortOrder: 4,
  },
] as const;

async function main(): Promise<void> {
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      // update 不含 isOriginal:建后归后台管理,重播 seed 不回灌覆盖
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
