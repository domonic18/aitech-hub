/**
 * 文章生成配置(2026-10-20 详情页重构;2026-10-21 §13.8 交互重构)——
 * 把「写一篇什么样的文章」拆成 MECE 四维:内容形式 × 口吻语感 × 篇幅 × 配图,
 * 外加封面图勾选(勾选型开关不入维度组)。§13.8 定位:选项归选项、补充归补充:
 * - 载体三段式(仍是 positioning 单字段,零 schema):体裁模板(内部资产,
 *   不暴露编辑)+ 条款行(选项卡驱动)+【补充要求】自由块(用户自由文本
 *   verbatim 透传 AI)。
 * - 选项卡只由点击驱动;自由文本永不因点选项被销毁——解析时未识别行(含
 *   被手改的体裁模板 prose)一律收进补充块(无损不变量)。
 * - custom 仅=体裁模板被手改(不再因存在自由文本触发):deriveSkillKey
 *   技能路由在带补充要求时照常派生(修复:自由文本杀死技能路由的隐藏耦合)。
 * 样例节选(内容形式/措辞示范)依据 2026-10 行业写法调研:公众号技术文钩子
 * +递进小标题、教程体前置清单+可复现分步、安利体先给结论与收益、口吻基准
 * 「口语但可信」。扩展新维度 = 加 CLAUSE 注册 + WRITING_DIMENSIONS 加组,
 * 合成/解析自动纳入(写作配置面板零改动)。
 */
import {
  DEFAULT_TOPIC_POSITIONING,
  matchTopicPurpose,
  TOPIC_PURPOSES,
  type TopicPurposeKey,
} from "./constants";

/** 内容形式(复用体裁治理预置;视频安利 = 缺省) */
export type WritingFormKey = TopicPurposeKey;
/** 口吻语感:friendly=懂行朋友(模板自带,缺省);editorial=专业编辑 */
export type WritingToneKey = "friendly" | "editorial";
/** 篇幅:standard=标准 ≈1200 字(指南缺省,不出条款);compact=精炼 ≈800 字 */
export type WritingLengthKey = "standard" | "compact";
/** 配图:cards=信息卡为主(指南缺省,不出条款);illustrate=文生图插画为主;
 * minimal=少图纯文字(M39 批②三选) */
export type WritingVisualKey = "cards" | "illustrate" | "minimal";
/** 封面图:generate=合成流程自动生成封面候选(缺省,不出条款);skip=不生成,
 * 重写时保留关联稿现有封面(M39 批④+ 用户补充勾选项) */
export type WritingCoverKey = "generate" | "skip";

export interface WritingSelection {
  form: WritingFormKey;
  tone: WritingToneKey;
  length: WritingLengthKey;
  visual: WritingVisualKey;
  cover: WritingCoverKey;
}

export const DEFAULT_WRITING_SELECTION: WritingSelection = {
  form: "video-recommend",
  tone: "friendly",
  length: "standard",
  visual: "cards",
  cover: "generate",
};

/** 条款行(非缺省维合成进写作要求;精确字符串,反向解析锚点,勿改动文案) */
const TONE_CLAUSE: Record<WritingToneKey, string | null> = {
  friendly: null,
  editorial: "口吻:专业编辑,克制陈述,让数据与事实说话,少用感叹号与网络流行语。",
};
const LENGTH_CLAUSE: Record<WritingLengthKey, string | null> = {
  standard: null,
  compact: "篇幅:精炼,全文约 800 字,每节只留一个核心论点与一条证据。",
};
const VISUAL_CLAUSE: Record<WritingVisualKey, string | null> = {
  cards: null,
  illustrate: "配图:文生图插画为主,按小节内容生成概念/场景插画(数据密集内容仍可配信息卡)。",
  minimal: "配图:少图,最多 1 张信息卡,以文字与行内链接表达为主。",
};
const COVER_CLAUSE: Record<WritingCoverKey, string | null> = {
  generate: null,
  skip: "封面:不生成封面图,重写时保留现有封面。",
};

/** 补充要求块头(自由补充与机器载荷的分界锚点;解析只认第一处,补充正文里
 * 再出现同款头不会被二次切分) */
export const SUPPLEMENT_HEADER = "【补充要求】";

/** 选择 + 补充 → 写作要求文本(单向;缺省维不出条款 = 纯模板,存量兼容)。
 * 三段式载体(§13.8):体裁模板 + 条款行 + 补充块;点选项只重建前两段,
 * 补充块原样保留 */
export function composeWritingText(sel: WritingSelection, supplement?: string | null): string {
  const template =
    TOPIC_PURPOSES.find((t) => t.key === sel.form)?.positioningTemplate ??
    DEFAULT_TOPIC_POSITIONING;
  const clauses = [
    TONE_CLAUSE[sel.tone],
    LENGTH_CLAUSE[sel.length],
    VISUAL_CLAUSE[sel.visual],
    COVER_CLAUSE[sel.cover],
  ];
  const present = clauses.filter((c): c is string => c !== null);
  const head = present.length ? `${template}\n${present.join("\n")}` : template;
  const supp = (supplement ?? "").trim();
  return supp ? `${head}\n${SUPPLEMENT_HEADER}\n${supp}` : head;
}

/** 解析结果:selection 尽力回显;supplement=自由补充块(未识别内容的无损
 * 归宿,含被手改的体裁模板 prose);custom 仅=体裁模板被手改/条款行冲突 */
export interface WritingParse {
  selection: WritingSelection;
  supplement: string;
  custom: boolean;
}

/** 写作要求文本 → 选择 + 补充(§13.8):【补充要求】头切出自由块;已知条款
 * 行提取进选项;其余未识别行全部收进 supplement——保存永不销毁用户内容。
 * 体裁模板全等匹配才认 form(不猜);无模板可认时 form 回落缺省并由 custom
 * 提示用户核对(手改内容已在 supplement,不丢) */
export function parseWritingText(text: string | null): WritingParse {
  const lines = (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const headerIdx = lines.indexOf(SUPPLEMENT_HEADER);
  const headLines = headerIdx >= 0 ? lines.slice(0, headerIdx) : lines;
  const suppLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : [];
  const clauseLines = new Set(
    [TONE_CLAUSE, LENGTH_CLAUSE, VISUAL_CLAUSE, COVER_CLAUSE].flatMap((m) =>
      Object.values(m).filter((c): c is string => c !== null),
    ),
  );
  const found = {
    tone: undefined,
    length: undefined,
    visual: undefined,
    cover: undefined,
  } as Record<string, unknown>;
  const rest: string[] = [];
  let custom = false;
  for (const line of headLines) {
    if (line === TONE_CLAUSE.editorial) {
      if (found.tone !== undefined) custom = true;
      found.tone = "editorial";
    } else if (line === LENGTH_CLAUSE.compact) {
      if (found.length !== undefined) custom = true;
      found.length = "compact";
    } else if (line === VISUAL_CLAUSE.illustrate) {
      if (found.visual !== undefined) custom = true;
      found.visual = "illustrate";
    } else if (line === VISUAL_CLAUSE.minimal) {
      if (found.visual !== undefined) custom = true;
      found.visual = "minimal";
    } else if (line === COVER_CLAUSE.skip) {
      if (found.cover !== undefined) custom = true;
      found.cover = "skip";
    } else {
      // 未识别行(含同维冲突条款与手改模板 prose)——无损收进补充块
      if (clauseLines.has(line)) custom = true; // 同维冲突条款(不该出现,防御)
      rest.push(line);
    }
  }
  const form = matchTopicPurpose(rest.join("\n") || null);
  if (form === null) custom = true;
  // 模板精确命中 = 被识别的体裁行,不漏进补充块(仅手改/未识别的行才进补充)
  const suppRest =
    form !== null
      ? rest.filter((l) => l !== TOPIC_PURPOSES.find((t) => t.key === form)?.positioningTemplate)
      : rest;
  return {
    selection: {
      form: form ?? DEFAULT_WRITING_SELECTION.form,
      tone: (found.tone as WritingToneKey) ?? DEFAULT_WRITING_SELECTION.tone,
      length: (found.length as WritingLengthKey) ?? DEFAULT_WRITING_SELECTION.length,
      visual: (found.visual as WritingVisualKey) ?? DEFAULT_WRITING_SELECTION.visual,
      cover: (found.cover as WritingCoverKey) ?? DEFAULT_WRITING_SELECTION.cover,
    },
    supplement: [...suppRest, ...suppLines].join("\n"),
    custom,
  };
}

/** 生成话术体裁词 + 展示名(服务端单点派生,自详情页传给生成动作):
 * 自定义写作要求时体裁词回落「视频安利稿」(与历史 fallback 口径一致) */
export function resolvePurpose(positioning: string | null): {
  label: string;
  genreWord: string;
  custom: boolean;
} {
  const { selection, custom } = parseWritingText(positioning);
  const preset = TOPIC_PURPOSES.find((t) => t.key === selection.form);
  if (custom || !preset) {
    return {
      label: "自定义写作要求",
      genreWord: TOPIC_PURPOSES[0]?.genreWord ?? "视频安利稿",
      custom: true,
    };
  }
  return { label: preset.label, genreWord: preset.genreWord, custom: false };
}

/**
 * 形式 → skillKey 单点派生(M39 批②):定位文本精确命中预置形式(含缺省
 * 「视频安利」,空串视同未设置=缺省)时返回注册表 skillKey,服务端在
 * positioning 落库的同一请求里一并回写 topic.skillKey;自定义文本返回
 * undefined = 不动人工绑定(PATCH/POST 路由同源调用,UI 不经手)。
 */
export function deriveSkillKey(positioning: string | null): string | undefined {
  const { selection, custom } = parseWritingText(positioning);
  if (custom) return undefined;
  return TOPIC_PURPOSES.find((t) => t.key === selection.form)?.skillKey;
}

/**
 * 定位文本是否勾选「不生成封面图」(M39 批④+):brief 结构化标记与
 * generate_cover_candidates 工具守卫同源消费;条款行锚点独立于 custom 判定
 * (手改文本 + 已知条款行仍回显,同配图维口径)。缺省/未设置 = 生成封面。
 */
export function skipCoverGeneration(positioning: string | null): boolean {
  return parseWritingText(positioning).selection.cover === "skip";
}

/** ── 可视化配置元数据(选项说明 + 样例节选;面板渲染用)────────── */

export interface WritingOption {
  key: string;
  label: string;
  /** 一句话:什么时候选它 */
  desc: string;
  /** 样例节选(措辞示范;空串 = 无文本样例,如配图的信息卡走真实渲染预览) */
  sample: string;
}

export interface WritingDimension {
  key: "form" | "tone" | "length" | "visual";
  title: string;
  hint: string;
  options: WritingOption[];
}

export const WRITING_DIMENSIONS: readonly WritingDimension[] = [
  {
    key: "form",
    title: "内容形式",
    hint: "文章最终长成什么样子,决定整体骨架。",
    options: [
      {
        key: "video-recommend",
        label: TOPIC_PURPOSES[0]?.label ?? "视频安利",
        desc: "推荐一支值得看的视频:讲透亮点,给出去看的理由。",
        sample:
          "先说结论:这支 21 分钟的视频,把端侧推理的成本账算明白了。\n" +
          "作者不是念参数表——他用一台 8GB 内存的旧笔记本当场跑给你看,\n" +
          "推理耗时从 40 分钟压到 6 分钟,中间踩的三个坑也都摆了出来。",
      },
      {
        key: "video-tutorial",
        label: TOPIC_PURPOSES[1]?.label ?? "视频安利+文字版教程",
        desc: "教程类视频:把内容整理成读者能直接跟做的分步教程。",
        sample:
          "准备:一个 Hugging Face 账号、10GB 磁盘空间。\n" +
          "第 1 步:拉取镜像并启动容器(先确认 CUDA 版本再选 tag)。\n" +
          "第 2 步:挂载模型目录,修改配置里的量化参数。\n" +
          "跟完你手里会多一个能跑的本地知识库,全程不用写代码。",
      },
      {
        key: "open-source-intro",
        label: TOPIC_PURPOSES[2]?.label ?? "开源项目介绍",
        desc: "讲清一个项目解决什么问题、凭什么值得上手,给最小可复现路径。",
        sample:
          "先给结论:如果你在找「本地就能跑的向量检索」,这个项目值得先试。\n" +
          "它不堆功能——核心只有一个嵌入索引,但把九成内存省在了量化上;\n" +
          "README 五分钟能跑通第一个 demo,坑都替你标好了。",
      },
      {
        key: "paper-interpret",
        label: TOPIC_PURPOSES[3]?.label ?? "论文解读",
        desc: "讲清论文回答了什么问题、结论改变了什么,方法直觉优先。",
        sample:
          "这篇论文回答的问题很直接:小模型能不能在推理阶段「临时变聪明」。\n" +
          "方法直觉一句话:与其把所有知识塞进参数,不如教会模型按需查笔记。\n" +
          "关键实验里,7B 模型挂上检索后在数学基准上追平了 34B。",
      },
      {
        key: "tutorial-refine",
        label: TOPIC_PURPOSES[4]?.label ?? "教程精炼",
        desc: "教程/实操素材:只留必要步骤与参数的精炼版跟做手册。",
        sample:
          "准备:一个 GitHub 账号、装好 Node 20+。\n" +
          "第 1 步:克隆仓库并安装依赖(国内网络记得设镜像)。\n" +
          "第 2 步:复制 .env.example 并填入 API Key。\n" +
          "常见坑:端口占用就换 PORT,Node 版本低了会直接启动失败。",
      },
      {
        key: "weekly-news",
        label: TOPIC_PURPOSES[5]?.label ?? "周新闻精选",
        desc: "一周 AI 动态分组综述:每条一句话讲清发生了什么、为何值得在意。",
        sample:
          "本周速览:① 两家头部厂商同日发布新旗舰模型;② 开源社区出现首个\n" +
          "跑通手机端的多模态框架;③ 国内大模型价格再降一轮。\n" +
          "下面按「模型 / 框架 / 行业」三组展开。",
      },
      {
        key: "model-pricing",
        label: TOPIC_PURPOSES[6]?.label ?? "模型价格表",
        desc: "模型牌价速查:表格为主干,客观比对与选购建议,不臆测定价。",
        sample:
          "先看结论表(数据截稿 2026-10,单位:元/百万 tokens):\n" +
          "| 模型 | 输入 | 输出 | 免费额度 |\n" +
          "选购建议一句话:重度对话选输出便宜的,长文档处理优先看输入价。",
      },
    ],
  },
  {
    key: "tone",
    title: "口吻语感",
    hint: "同一件事的两种说法,决定读者觉得你是朋友还是编辑。",
    options: [
      {
        key: "friendly",
        label: "懂行朋友",
        desc: "口语化安利,像懂行的朋友聊给他听(缺省)。",
        sample:
          "「这玩意儿最狠的地方在于:8GB 的旧笔记本居然真的能跑——\n" +
          "我当场试了,比想象中靠谱,风扇都没怎么转。」",
      },
      {
        key: "editorial",
        label: "专业编辑",
        desc: "克制陈述,数据与事实说话,适合偏正式的栏目感。",
        sample:
          "「实测中,量化后的模型将推理耗时由 40 分钟降至 6 分钟,\n" +
          "内存峰值控制在 7.2GB,未出现交换分区写入。」",
      },
    ],
  },
  {
    key: "length",
    title: "篇幅",
    hint: "短文利传播,长文利收藏;改的是详略,不是信息量。",
    options: [
      {
        key: "standard",
        label: "标准 ≈1200 字",
        desc: "5 小节左右,含背景铺垫与细节展开(缺省,约 5 分钟读完)。",
        sample: "目录:钩子 → 背景与来龙去脉 → 博主是谁 → 核心内容 → 值得看的理由",
      },
      {
        key: "compact",
        label: "精炼 ≈800 字",
        desc: "3 小节,每节一个论点一条证据,约 3 分钟读完。",
        sample: "目录:结论先行 → 关键数据 → 值不值得看",
      },
    ],
  },
  {
    key: "visual",
    title: "配图",
    hint: "信息卡由 AI 按内容自动设计生成;插画由文生图模型按内容绘制。",
    options: [
      {
        key: "cards",
        label: "信息卡为主",
        desc: "按内容自动生成 HTML 信息卡(金句/数据/步骤卡等),1~3 张(缺省)。",
        sample: "",
      },
      {
        key: "illustrate",
        label: "文生图插画为主",
        desc: "按小节内容生成概念/场景插画,适合叙事与氛围表达;数据密集内容仍可配信息卡。",
        sample: "",
      },
      {
        key: "minimal",
        label: "少图纯文字",
        desc: "最多 1 张卡,靠文字与行内链接表达,阅读节奏更紧凑。",
        sample: "",
      },
    ],
  },
];

/** 配图维度「信息卡为主」的真实渲染预览样例(走 /api/card-presets/preview,
 * 只渲不传零副作用;数据与 preset-schema 对齐) */
export const VISUAL_SAMPLE_CARDS: readonly { preset: "quote" | "stats"; data: unknown }[] = [
  {
    preset: "quote",
    data: {
      quote: "端侧推理的成本拐点已经过了——8GB 内存也能跑出可用的速度。",
      author: "示例 · 金句卡",
    },
  },
  {
    preset: "stats",
    data: {
      title: "示例 · 数据卡",
      items: [
        { value: "6 分钟", label: "推理耗时(原 40 分钟)", delta: "-85%" },
        { value: "7.2GB", label: "内存峰值" },
      ],
    },
  },
];

/** 配图维度「文生图插画为主」的静态样例(M39 批②:生图模型预产出入
 * public/,入仓库;文生图无法零副作用实时预览——每张计费且 10~30s,静态
 * 样例是唯一务实解,与信息卡真实渲染互为对照) */
export const VISUAL_SAMPLE_ILLUSTRATIONS: readonly { src: string; alt: string }[] = [
  { src: "/images/writing/illustrate-sample-1.jpg", alt: "文生图插画样例 1:概念场景图" },
  { src: "/images/writing/illustrate-sample-2.jpg", alt: "文生图插画样例 2:数据叙事氛围图" },
];
