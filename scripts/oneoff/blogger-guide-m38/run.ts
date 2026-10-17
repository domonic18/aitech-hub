/**
 * 指南 M38 订正:agent_skill 指南文本整体替换为 src/lib/ai/writing-guides.ts
 * 现役文本——① blogger-video(卡型路由扩至 11 卡型 + 信息设计纪律);
 * ② card-rendering(M31 旧文本退役:五卡型/白底 html 口径 → 11 卡型双主题口径,
 * 库内行缺失则补建)。seed 只补缺不改值,落库后的改值一律走本脚本。
 *
 * 自包含脚本:不用 @/ 别名(worker 容器无 tsconfig 解不开),相对路径
 * 引共享文本模块保证与 seed 同源;连接串只从 env 读,不打印。
 *
 * @status oneoff(本地+生产各执行一次,确认生效后删除本目录,git 历史存档)
 *
 * 用法:
 *   npx tsx scripts/oneoff/blogger-guide-m38/run.ts           # dry-run(默认,只显 diff 概要)
 *   npx tsx scripts/oneoff/blogger-guide-m38/run.ts --apply   # 写库
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

import { BLOGGER_VIDEO_GUIDE, CARD_RENDERING_GUIDE } from "../../../src/lib/ai/writing-guides";

const apply = process.argv.includes("--apply");

const TARGETS = [
  { key: "blogger-video", guide: BLOGGER_VIDEO_GUIDE, create: null },
  {
    key: "card-rendering",
    guide: CARD_RENDERING_GUIDE,
    create: { name: "图文卡片", scenario: "render_card 卡片工具的卡型选型与调用纪律(通用)" },
  },
] as const;

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const prisma = new PrismaClient();
  try {
    for (const t of TARGETS) {
      const skill = await prisma.agentSkill.findUnique({ where: { key: t.key } });
      if (!skill) {
        if (!t.create) {
          console.error(`未找到 key=${t.key} 的 skill,先跑 prisma db seed`);
          process.exit(1);
        }
        console.log(`${t.key}:库内缺失,${apply ? "--apply 补建" : "(dry-run,加 --apply 补建)"}`);
        if (!apply) continue;
        await prisma.agentSkill.create({
          data: { key: t.key, ...t.create, guideMd: t.guide },
        });
        console.log(`已补建:${t.key}`);
        continue;
      }
      if (skill.guideMd === t.guide) {
        console.log(`${t.key}:已是 M38 版本,无需更新`);
        continue;
      }
      console.log(
        `${t.key}:当前 ${skill.guideMd.length} 字符 → M38 版本 ${t.guide.length} 字符` +
          (apply ? "(--apply 写入)" : "(dry-run,加 --apply 生效)"),
      );
      if (!apply) continue;
      const updated = await prisma.agentSkill.update({
        where: { key: t.key },
        data: { guideMd: t.guide },
        select: { key: true, updatedAt: true },
      });
      console.log(`已更新:${updated.key} @ ${updated.updatedAt.toISOString()}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
