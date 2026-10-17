/**
 * 「博主×视频」指南 M36 订正:agent_skill(key=blogger-video)的 guide_md
 * 整体替换为 src/lib/ai/writing-guides.ts 的现役文本(视频重点从内联
 * HTML 笔记卡升级为 render_card 双主题图片卡)。seed 只补缺不改值,落库
 * 后的改值一律走本脚本。
 *
 * 自包含脚本:不用 @/ 别名(worker 容器无 tsconfig 解不开),相对路径
 * 引共享文本模块保证与 seed 同源;连接串只从 env 读,不打印。
 *
 * @status oneoff(本地+生产各执行一次,确认生效后删除本目录,git 历史存档)
 *
 * 用法:
 *   npx tsx scripts/oneoff/blogger-guide-m36/run.ts           # dry-run(默认,只显 diff 概要)
 *   npx tsx scripts/oneoff/blogger-guide-m36/run.ts --apply   # 写库
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

import { BLOGGER_VIDEO_GUIDE } from "../../../src/lib/ai/writing-guides";

const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const prisma = new PrismaClient();
  try {
    const skill = await prisma.agentSkill.findUnique({ where: { key: "blogger-video" } });
    if (!skill) {
      console.error("未找到 key=blogger-video 的 skill,先跑 prisma db seed");
      process.exit(1);
    }
    if (skill.guideMd === BLOGGER_VIDEO_GUIDE) {
      console.log("guide_md 已是 M36 版本,无需更新");
      return;
    }
    console.log(
      `当前版本 ${skill.guideMd.length} 字符 → M36 版本 ${BLOGGER_VIDEO_GUIDE.length} 字符` +
        (apply ? "(--apply 写入)" : "(dry-run,加 --apply 生效)"),
    );
    if (!apply) return;
    const updated = await prisma.agentSkill.update({
      where: { key: "blogger-video" },
      data: { guideMd: BLOGGER_VIDEO_GUIDE },
      select: { key: true, updatedAt: true },
    });
    console.log(`已更新:${updated.key} @ ${updated.updatedAt.toISOString()}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
