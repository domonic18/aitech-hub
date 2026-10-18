/**
 * blogger-video 指南「教程类视频」分支订正(2026-10-18):agent_skill 指南
 * 文本整体替换为 src/lib/ai/writing-guides.ts 现役文本——教程/实操类视频的
 * 核心内容笔记按「文字版教程」交付(第二人称分步、界面动作与输入内容、
 * 关键数字保留、结尾验收点),不做「视频演示了…」式第三人称转述。
 * post-319 验收反馈配套(教程意图无入口/教程写成转述稿),随「撰写目的」
 * 预置与 get_post_sources 工具同批落库。
 * 注:与 guide-dark-unify/blogger-guide-m38/card-guide-html 同为本类订正,
 * 本目录对两环境应用确认后四个目录可一并删除。
 *
 * 自包含脚本:不用 @/ 别名(worker 容器无 tsconfig 解不开),相对路径
 * 引共享文本模块保证与 seed 同源;连接串只从 env 读,不打印。
 *
 * @status oneoff(本地+生产各执行一次,确认生效后删除本目录,git 历史存档)
 *
 * 用法:
 *   npx tsx scripts/oneoff/blogger-guide-tutorial/run.ts           # dry-run(默认,只显 diff 概要)
 *   npx tsx scripts/oneoff/blogger-guide-tutorial/run.ts --apply   # 写库
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
      console.log("blogger-video:已是教程分支版本,无需更新");
      return;
    }
    console.log(
      `blogger-video:当前 ${skill.guideMd.length} 字符 → 教程分支版本 ${BLOGGER_VIDEO_GUIDE.length} 字符` +
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
