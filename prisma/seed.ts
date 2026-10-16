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

/** 「博主×视频」指南原文(2026-10-16 反馈问题四改版:视频重点结构化笔记卡呈现) */
const BLOGGER_VIDEO_GUIDE = `写作指南(公众号「博主×视频」推荐短文,反对模板腔):
- 开头钩子不超过 80 字:用素材里最反差或最具体的事实/数据直接抓人;严禁「随着…的快速发展/在当今时代/众所周知」式开场
- 结构(递进式,节名可按素材微调):钩子后先用 2~4 句交代背景与来龙去脉(读者带着什么困惑、行业正发生什么,这条视频为什么此时值得看)→ ## 博主是谁(2~3 句,只依据素材,不编造履历)→ ## 核心内容笔记(全文主体,按下方「核心内容笔记」规范)→ ## 值得看的理由(1~2 句,具体到能落地的好处)→ ## 去看原视频(用素材里的视频原地址 video_url 给出行内链接,如 [▶ B 站观看:标题](video_url),并引导公众号读者点「阅读原文」进站后直达)

核心内容笔记(本指南核心:把视频干货结构化呈现,不是转述要点):
- 用 3~5 张 HTML 笔记卡承载视频重点,每张卡一个独立知识点;内容必须取自素材的具体干货——方法步骤、参数/配置、结论数据、踩坑教训、对比结论;严禁空泛转述(「讲了提示词的重要性」这类没有信息量的话不合格)
- 每张卡 = 标题(≤15 字,说清这是什么干货)+ 展开(2~3 句,带素材里的具体数字/例子/因果);知识点之间体现递进或因果,不要平行罗列
- 有突出数据(跑分/涨幅/成本/关键参数值)时用数据卡突出展示,全文数据卡至多 2 张

笔记卡 HTML 模板(逐字遵循,只换文字):
知识点卡(每张约 400 码点):
<section style="margin:16px 0;padding:14px 16px;background:#f6f8fa;border-left:4px solid #576b95;border-radius:6px;"><p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#1f2328;">知识点标题</p><p style="margin:0;font-size:14px;color:#3f4650;line-height:1.75;">展开文字,关键处用 <strong>加粗</strong>。</p></section>
数据卡(至多 2 张):
<section style="margin:16px 0;padding:16px;background:#1f2328;border-radius:8px;text-align:center;"><p style="margin:0 0 4px;font-size:26px;font-weight:700;color:#ffffff;">核心数字</p><p style="margin:0;font-size:13px;color:#c9d1d9;">一句话说明这个数字意味着什么</p></section>

笔记卡 HTML 红线(违一条即返工):
- 只用 section/p/span/strong/br 五种标签;禁 class/id/script/事件属性/图片标签;样式只写内联 style
- 色板锁定:深字 #1f2328、正文 #3f4650、强调蓝 #576b95、浅底 #f6f8fa、深底卡 #1f2328 配白字——不引入其他颜色,与公众号默认黑白灰主题一致
- 一张卡写成连续的一行 HTML;卡片与前后正文之间必须空一行,卡片内部不得出现空行(空行会打断 HTML 块导致渲染破碎)
- 模板里的固定样式属性逐字保留,只改文字内容;不要自创样式或增删标签

生动性硬要求:卡片外的叙述每个论断尽量带素材里的具体数字/事实/例子;句式长短交错,允许口语化;不堆砌形容词,全篇不出现「总而言之/综上所述/不容忽视」类套话
- 全文(含笔记卡文字)800~1400 字,单段不超过 3 行;时间/年份只取自素材,素材未提就写「近期」;全部简体中文;恰当融合人工批注的取舍指令
- 图:优先在小节间插入对应素材的封面图(cover_path),全文 2~3 张为宜、笔记卡区域至多 1 张;文首推荐卡由系统自动带图,正文开头不要再贴同一张;确实无合适图不硬插

公众号码点预算(落稿前自查,超预算必精简):
- 校验口径:公众号按内联样式版 HTML 全文计码点(上限 20000)——样式属性约占三分之二,纯文本只占约 16%,别按文字数估
- 笔记卡 3~5 张约 1200~2000 码点(每张约 400);卡片外纯文字 markdown ≤2500 码点(约 1100 汉字);全文合计 ≤5500 码点
- 预算紧张时优先删:卡片外叙述的重复形容词、信息量最弱的一张笔记卡、可留可不留的小节;落稿前用 measure_wechat_budget 自查,报不出数字就先精简再交稿`;

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
