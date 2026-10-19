/**
 * blogger-video 指南封面纪律订正(2026-10-19):agent_skill 指南文本整体替换
 * 为 src/lib/ai/writing-guides.ts 现役文本——封面禁止入正文(呈现协调性反馈:
 * 写手把竖版封面当正文配图小节间乱插),文首推荐卡由系统落库时确定性注入,
 * 封面图无正文用途。PR #103 随 develop-97e7130 上线只带了代码层(提示词硬
 * 层已进镜像),本脚本补 L2 指南文本落库这一半。
 * 注:与 blogger-guide-m36/m38/guide-dark-unify/card-guide-html/blogger-guide-
 * tutorial 同为本类订正,应用确认后各目录可一并删除。
 *
 * 自包含脚本:不用 @/ 别名(worker 容器无 tsconfig 解不开),相对路径
 * 引共享文本模块保证与 seed 同源;连接串只从 env 读,不打印。
 *
 * @status oneoff(生产执行一次,确认生效后删除本目录,git 历史存档)
 *
 * 用法:
 *   npx tsx scripts/oneoff/blogger-guide-cover/run.ts           # dry-run(默认,只显 diff 概要)
 *   npx tsx scripts/oneoff/blogger-guide-cover/run.ts --apply   # 写库
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
      console.log("blogger-video:已是封面纪律版本,无需更新");
      return;
    }
    console.log(
      `blogger-video:当前 ${skill.guideMd.length} 字符 → 封面纪律版本 ${BLOGGER_VIDEO_GUIDE.length} 字符` +
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
