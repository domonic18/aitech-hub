import { PrismaClient } from "@prisma/client";

import { WRITING_SKILLS } from "../src/lib/ai/writing-guides";

/**
 * 种子数据(arch/03-data-model §1):四分类,幂等 upsert,可反复执行。
 * slug 沿用旧站四分类(3314 篇资讯分类路由由新站承接,内容不迁移);
 * admin 不预置,首次部署用脚本创建(M4 交付)。
 * M30 批① 增 agent skill 种子:收编 agent 提示词「博主×视频」指南 + 码点预算段
 * (update 分支为空——skill 落库后归后台所有,重跑种子不覆盖管理员编辑;
 * 指南文本真相源在 src/lib/ai/writing-guides.ts,M36 起改值走 oneoff 订正)。
 * M39 批④:注册表 WRITING_SKILLS 收编入真相源文件(含 5 场景新技能),本文件
 * 只管「只补缺」落库——已部署环境补新技能 = 重跑本脚本(幂等)。
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
  // skill 种子:只补缺不改值(落库后归后台所有)
  for (const s of WRITING_SKILLS) {
    await prisma.agentSkill.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
    console.log(`seeded agent skill: ${s.key}(${s.name})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
