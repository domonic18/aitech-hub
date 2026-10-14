import { PrismaClient } from "@prisma/client";

/**
 * 种子数据(arch/03-data-model §1):四分类,幂等 upsert,可反复执行。
 * slug 沿用旧站四分类(3314 篇资讯分类路由由新站承接,内容不迁移);
 * admin 不预置,首次部署用脚本创建(M4 交付)。
 * M30 批① 增 agent skill 种子:收编 agent 提示词「博主×视频」指南 + 码点预算段
 * (update 分支为空——skill 落库后归后台所有,重跑种子不覆盖管理员编辑)。
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

/** 「博主×视频」指南原文(M27 起 hardcode 于 agent.ts,批② 改由工具取用) */
const BLOGGER_VIDEO_GUIDE = `写作指南(公众号「博主×视频」推荐短文,反对模板腔):
- 开头钩子不超过 80 字:用素材里最反差或最具体的事实/数据直接抓人;严禁「随着…的快速发展/在当今时代/众所周知」式开场
- 结构(递进式,节名可按素材微调):钩子后先用 2~4 句交代背景与来龙去脉(读者带着什么困惑、行业正发生什么,这条视频为什么此时值得看)→ ## 博主是谁(2~4 句,只依据素材,不编造履历)→ ## 视频讲了什么(3~4 个要点,要点之间体现递进或因果,不要平行罗列;段首 **加粗**)→ ## 值得看的理由(1~2 句,具体到能落地的好处)→ ## 去看原视频(用素材里的视频原地址 video_url 给出行内链接,如 [▶ B 站观看:标题](video_url),并引导公众号读者点「阅读原文」进站后直达)
- 生动性硬要求:每个论断尽量带素材里的具体数字/事实/例子;句式长短交错,允许口语化;不堆砌形容词,全篇不出现「总而言之/综上所述/不容忽视」类套话
- 全文 800~1200 字,单段不超过 3 行;时间/年份只取自素材,素材未提就写「近期」;全部简体中文;恰当融合人工批注的取舍指令
- 图:优先在「视频讲了什么」等小节插入对应素材的封面图(cover_path),全文 2~4 张为宜、每节至多 1 张;文首推荐卡由系统自动带图,正文开头不要再贴同一张;确实无合适图不硬插

公众号码点预算(落稿前自查,超预算必精简):
- 校验口径:公众号按内联样式版 HTML 全文计码点(上限 20000)——样式属性约占三分之二、表格约占四分之一,纯文本只占约 16%,别按文字数估
- 正文 markdown 控制在 ≤4500 码点(约 2000 汉字);每张表格预留约 2200 HTML 码点,无必要不铺表格,能用短句说清的不列表
- 预算紧张时优先删:重复形容词、平行罗列合并为递进句、可留可不留的小节;落稿前用码点计量工具自查,报不出数字就先精简再交稿`;

const WRITING_SKILLS = [
  {
    key: "blogger-video",
    name: "博主×视频推荐短文",
    scenario: "公众号「博主×视频」推荐短文(专题合成默认场景)",
    guideMd: BLOGGER_VIDEO_GUIDE,
    enabled: true,
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
