/**
 * Coding Plan 渠道爬取单测(M56,fixture 无真网无真库):Kimi 会员定价页/
 * GLM 渲染态卡片解析(周期三态合并:月付价/季/年折合月价+折扣原文;权益整列
 * 入库;改版抛错)/ 注册表编排:三规则+单源失败自吞+打标。
 * Kimi 年付=周期总价(¥468/年),GLM 季/年=折合每月——口径不归一随原文(D3)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findPlans = vi.fn();
const createPlan = vi.fn();
const updatePlan = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    codingPlan: {
      findMany: (...a: unknown[]) => findPlans(...a),
      create: (...a: unknown[]) => createPlan(...a),
      update: (...a: unknown[]) => updatePlan(...a),
    },
  },
}));

import {
  parseBailianToken,
  parseGlmCoding,
  parseKimiCoding,
  parseKimiCards,
  parseMiniMaxCoding,
  parseXiaomiToken,
  markPlanSourceStale,
  persistPlanRows,
} from "./plan-sources";

const NOW = new Date("2026-10-29T00:00:00Z");
const KIMI_URL = "https://www.kimi.com/membership/pricing?from=kfc_membership_topbar";
const GLM_URL = "https://bigmodel.cn/glm-coding";

/** Kimi 会员定价页卡片(按 2026-10-29 真实 DOM 结构,data-v/svg 已去噪;
 * 权益=plan-feature 列表项,markdown 内段落) */
function kimiCard(
  title: string,
  tagline: string,
  amount: string,
  opts: {
    strikethrough?: string;
    billingCycle?: string;
    benefits?: string[];
    experimental?: string[];
  } = {},
): string {
  const feat = (f: string): string =>
    `<div class="plan-feature"><!----> [svg] <div class="markdown markdown plan-feature-markdown"><div class="paragraph" dir="auto">${f}</div></div></div>`;
  const core =
    opts.benefits === undefined
      ? [feat("更多 Agent 额度"), feat("Office 文件处理")]
      : opts.benefits.map(feat);
  const exp =
    opts.experimental === undefined
      ? ""
      : `<p class="plan-experimental-title">实验性功能</p><div class="plan-features plan-experimental-features divider">${opts.experimental
          .map(feat)
          .join("")}</div>`;
  return `<div class="plan-container plan"><div class="plan-title">${title} <div class="plan-note"></div></div>
<p class="plan-tagline"><span>${tagline}</span></p>
<p class="plan-price"><span class="price-prefix">¥</span> <span class="price-amount">${amount}</span> <span class="price-suffix">/ 月</span>${
    opts.strikethrough === undefined
      ? ""
      : ` <span class="price-strikethrough">¥${opts.strikethrough}</span>`
  }</p>
${opts.billingCycle === undefined ? "" : `<p class="plan-billing-cycle">${opts.billingCycle}</p>`}
<div class="plan-features divider">${core.join("")}</div>${exp}</div>`;
}

const KIMI_MONTHLY = `<div class="pricing-tabs filled"><button class="pricing-tab active">连续包月</button><button class="pricing-tab">连续包年 <span class="pricing-tab-badge">最高立省 ¥3,360</span></button></div>${kimiCard(
  "Go",
  "日常使用",
  "49",
  {
    benefits: ["更多 Agent 额度", "Office 文件处理", "深度研究", "网站部署"],
    experimental: ["定制化看板,包含小组件任务"],
  },
)}${kimiCard("Plus", "效率升级", "99", {
  benefits: ["2 倍 Agent 额度", "Kimi Code 可调用"],
  experimental: ["集群功能"],
})}`;

const KIMI_YEARLY = `${kimiCard("Go", "日常使用", "39", {
  strikethrough: "49",
  billingCycle: "按年计费 ¥468",
  benefits: ["更多 Agent 额度", "深度研究"],
})}${kimiCard("Plus", "效率升级", "79", {
  strikethrough: "99",
  billingCycle: "按年计费 ¥948",
  benefits: ["2 倍 Agent 额度"],
})}`;

/** GLM 三态(价格取 2026-10-29 用户验收时点:月付 49/149/469,季 9 折,年 8 折) */
function glmCard(
  title: string,
  description: string,
  shown: string,
  opts: {
    original?: string;
    features?: string[];
  } = {},
): string {
  const feats = opts.features ?? ["逐步开放最新旗舰模型及功能", "支持 Claude Code 等 20+ 编程工具"];
  return `<div class="cp-card flex"><header class="cp-card__header flex flex-col gap-10"><div class="cp-card__title-row flex items-center gap-14"><h3 class="cp-card__title">${title}</h3></div><p class="cp-card__description">${description}</p></header><div class="cp-card__price no-tags"><div class="cp-card__price-row flex items-baseline gap-8"><div class="cp-card__price-current flex items-baseline"><span class="cp-card__price-symbol">¥</span><span class="cp-card__price-amount">${shown}</span><span class="cp-card__price-unit">/月</span></div>${
    opts.original === undefined
      ? ""
      : `<div class="cp-card__price-original flex items-baseline"><span class="cp-card__price-symbol">¥</span><span>${opts.original}</span><span>/月</span></div>`
  }</div></div><ul class="cp-card__features">${feats
    .map(
      (f, i) =>
        `<li class="cp-card__feature${i === 0 ? " cp-card__feature--highlight" : ""} flex flex-row items-center gap-6"><span class="cp-card__feature-text"> ${f} </span></li>`,
    )
    .join("")}</ul></div>`;
}

const GLM_TABS = `<div>连续包月 连续包季 9折 连续包年 8折</div>`;
const GLM_MONTHLY = `${GLM_TABS}${glmCard("Lite", "日常使用", "49")}${glmCard(
  "Pro",
  "高频使用",
  "149",
  {
    features: ["5x Lite 用量额度", "Lite 全部权益", "优先体验最新旗舰模型及功能"],
  },
)}${glmCard("Max", "深度使用", "469", { features: ["20x Lite 用量额度", "Pro 全部权益"] })}`;
const GLM_QUARTERLY = `${glmCard("Lite", "日常使用", "44.1", { original: "49" })}${glmCard(
  "Pro",
  "高频使用",
  "134.1",
  { original: "149" },
)}${glmCard("Max", "深度使用", "422.1", { original: "469" })}`;
const GLM_YEARLY = `${glmCard("Lite", "日常使用", "39.2", { original: "49" })}${glmCard(
  "Pro",
  "高频使用",
  "119.2",
  { original: "149" },
)}${glmCard("Max", "深度使用", "375.2", { original: "469" })}`;

describe("parseKimiCards / parseKimiCoding", () => {
  it("单态卡片解析:档名/标签/价格/划线价/周期口径/权益列表(核心+实验性页序)", () => {
    const cards = parseKimiCards(KIMI_MONTHLY);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      title: "Go",
      tagline: "日常使用",
      amount: 49,
      strikethrough: null,
    });
    expect(cards[0]!.benefits).toEqual([
      "更多 Agent 额度",
      "Office 文件处理",
      "深度研究",
      "网站部署",
      "定制化看板,包含小组件任务",
    ]);
  });

  it("双态合并:月付=包月态价;年付=周期总价;权益整列入库;额度=权益首条", () => {
    const rows = parseKimiCoding({ monthly: KIMI_MONTHLY, yearly: KIMI_YEARLY }, KIMI_URL, NOW);
    expect(rows.map((r) => r.planName)).toEqual(["Kimi 会员 · Go", "Kimi 会员 · Plus"]);
    expect(rows[0]).toMatchObject({
      vendor: "月之暗面 Kimi",
      monthlyFee: 49,
      quarterlyFee: null,
      yearlyFee: 468, // 周期总价(非折合月,口径入 billingNote)
      billingNote: "年付为周期总价(官方原文「按年计费 ¥468」);月付展示价可能含促销",
      benefits: [
        "更多 Agent 额度",
        "Office 文件处理",
        "深度研究",
        "网站部署",
        "定制化看板,包含小组件任务",
      ],
      quotaDesc: "更多 Agent 额度",
      bestFor: "日常使用",
    });
    expect(rows[1]).toMatchObject({ monthlyFee: 99, yearlyFee: 948 });
  });

  it("结构丢失(前端重构)抛错——源失败可见不静默", () => {
    expect(() =>
      parseKimiCoding({ monthly: "<p>x</p>", yearly: "<p>x</p>" }, KIMI_URL, NOW),
    ).toThrow("kimi 会员卡结构未匹配");
  });
});

describe("parseGlmCoding", () => {
  it("三态合并:月付/季/年折合月价+折扣原文;权益全列;额度=首条 feature", () => {
    const rows = parseGlmCoding(
      { monthly: GLM_MONTHLY, quarterly: GLM_QUARTERLY, yearly: GLM_YEARLY },
      GLM_URL,
      NOW,
    );
    expect(rows.map((r) => r.planName)).toEqual([
      "GLM Coding Plan · Lite",
      "GLM Coding Plan · Pro",
      "GLM Coding Plan · Max",
    ]);
    expect(rows[0]).toMatchObject({
      vendor: "智谱 AI · BigModel",
      monthlyFee: 49,
      quarterlyFee: 44.1,
      yearlyFee: 39.2,
      billingNote: "连续包季9折折合 ¥44.1/月;连续包年8折折合 ¥39.2/月",
      benefits: ["逐步开放最新旗舰模型及功能", "支持 Claude Code 等 20+ 编程工具"],
      quotaDesc: "逐步开放最新旗舰模型及功能",
      bestFor: "日常使用",
      offPeakRate: "谷 0.5×",
    });
    expect(rows[1]).toMatchObject({
      monthlyFee: 149,
      quarterlyFee: 134.1,
      quotaDesc: "5x Lite 用量额度",
    });
  });

  it("结构丢失(前端重构)抛错——源失败可见不静默", () => {
    expect(() =>
      parseGlmCoding({ monthly: "<p>x</p>", quarterly: "", yearly: "" }, GLM_URL, NOW),
    ).toThrow("glm-coding 卡片结构未匹配");
  });
});

describe("persistPlanRows 初稿三规则", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const rows = parseGlmCoding(
    { monthly: GLM_MONTHLY, quarterly: GLM_QUARTERLY, yearly: GLM_YEARLY },
    GLM_URL,
    NOW,
  );

  it("不存在→建 pending(benefits 整列);pending→刷新;enabled→不动", async () => {
    findPlans.mockResolvedValue([
      {
        id: BigInt(31),
        vendor: "智谱 AI · BigModel",
        planName: "GLM Coding Plan · Lite",
        status: "pending",
      },
    ]);
    updatePlan.mockResolvedValue({ id: BigInt(31) });
    const t = await persistPlanRows(rows);
    expect(t).toMatchObject({ created: 2, refreshed: 1, untouched: 0, failed: 0 });
    const created = createPlan.mock.calls[0]![0] as {
      data: { planName: string; status: string; benefits: string[]; quarterlyFee: number };
    };
    expect(created.data.planName).toBe("GLM Coding Plan · Pro"); // Lite enabled 不动,首个建=Pro
    expect(created.data.status).toBe("pending");
    expect(created.data.benefits).toEqual([
      "5x Lite 用量额度",
      "Lite 全部权益",
      "优先体验最新旗舰模型及功能",
    ]);
    const upd = updatePlan.mock.calls[0]![0] as {
      where: { id: bigint };
      data: { status?: string; quarterlyFee: number; yearlyFee: number };
    };
    expect(upd.where.id).toBe(BigInt(31));
    expect(upd.data.status).toBeUndefined(); // 刷新不触状态机
    expect(upd.data.quarterlyFee).toBe(44.1); // 周期价随行刷新
  });
});

describe("markPlanSourceStale 打标", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("按 sourceUrl 圈定打标(替换旧标;note=null 兜底)", async () => {
    findPlans.mockResolvedValue([
      { id: BigInt(31), note: "[爬虫 2026-10-21] 注记" },
      { id: BigInt(32), note: null },
    ]);
    updatePlan.mockResolvedValue({ id: BigInt(31) });
    const n = await markPlanSourceStale(GLM_URL, NOW);
    expect(n).toBe(2);
    expect((updatePlan.mock.calls[0]![0] as { data: { note: string } }).data.note).toBe(
      "【待复核 2026-10-29 爬取失败】[爬虫 2026-10-21] 注记",
    );
    expect((updatePlan.mock.calls[1]![0] as { data: { note: string } }).data.note).toBe(
      "【待复核 2026-10-29 爬取失败】",
    );
  });
});

// ---------- 新三源 fixture(2026-10-29 真实快照裁剪) ----------

/** MiniMax 国内版(www.minimax.cn/m-plan)真实快照裁剪:三张卡按原 DOM 结构
 * (header>h3 定位卡片根 / 划线价 span.line-through / 现价 span.tabular-nums /
 * 周期文案 div / 权益 article>p),仅删样式类与图片、每卡保留 3 条权益。
 * 2026-10-29 换国内版前该源为海外站($ + 英文档名),旧折叠文本正则已退役。 */
const MM_CN_CARD = (
  title: string,
  tagline: string,
  orig: string,
  now: string,
  per: string,
  b1: string,
  b2: string,
  b3: string,
  promo?: string,
): string =>
  `<div class="card"><header><h3>${title}</h3>${promo === undefined ? "" : `<span>${promo}</span>`}</header><p>${tagline}</p><div><span class="line-through">${orig}</span></div><div><span>￥</span><span class="tabular-nums">${now}</span></div><div>${per}</div><button><span>立即订阅</span></button><article><p>${b1}</p><p>${b2}</p><p>${b3}</p></article></div>`;

const MM_YEARLY = [
  MM_CN_CARD(
    "Go",
    "轻松上手",
    "￥588",
    "490",
    "每年，按年订阅",
    "更多用量",
    "文本模型，如 M3.1 Flash",
    "图像和声音模型",
  ),
  MM_CN_CARD(
    "Explore",
    "日常使用",
    "￥1,490",
    "1,190",
    "每年，按年订阅",
    "Go 的 3 倍用量",
    "文本模型，如 M3.1 Flash",
    "视频模型，如 H3",
  ),
  MM_CN_CARD(
    "Build",
    "全力创造",
    "￥5,628",
    "4,690",
    "每年，按年订阅",
    "Go 的 12 倍用量",
    "文本模型，如 M3.1 Flash",
    "视频模型，如 H3",
  ),
].join("");
const MM_MONTHLY = [
  MM_CN_CARD(
    "Go",
    "轻松上手",
    "￥49",
    "24.5",
    "每月，按月订阅",
    "更多用量",
    "文本模型，如 M3.1 Flash",
    "图像和声音模型",
    "限时首月5折",
  ),
  MM_CN_CARD(
    "Explore",
    "日常使用",
    "￥119",
    "59.5",
    "每月，按月订阅",
    "Go 的 3 倍用量",
    "文本模型，如 M3.1 Flash",
    "视频模型，如 H3",
    "限时首月5折",
  ),
  MM_CN_CARD(
    "Build",
    "全力创造",
    "￥469",
    "234.5",
    "每月，按月订阅",
    "Go 的 12 倍用量",
    "文本模型，如 M3.1 Flash",
    "视频模型，如 H3",
    "限时首月5折",
  ),
].join("");
/** 小米 Token Plan 卡片(按 2026-10-29 真实 DOM 裁剪):档名 `<p>`(24px)定位
 * 卡片根 `rounded-[16px]`,主价 `span.font-misans`、划线价 `span.line-through`,
 * 权益为 14px 明细行对(主行 #1a1a1a 开条、次行 text-black/45 并入上一条)。 */
function xmCard(
  title: string,
  tagline: string,
  shown: string,
  standard: string,
  discount: string,
  credits: string,
  extra: string,
): string {
  const line = (main: string, sub?: string): string =>
    `<p class="text-[14px] leading-4 text-[#1a1a1a]">${main}</p>${
      sub === undefined ? "" : `<p class="text-[14px] leading-4 text-black/45">${sub}</p>`
    }`;
  return `<div class="relative flex w-full"><div class="flex flex-col gap-2"><p class="whitespace-nowrap text-[24px] font-medium leading-8">${title}</p><p class="text-[14px] leading-5 text-black/45">${tagline}</p></div></div><div class="relative overflow-visible rounded-[16px]"><div class="relative flex w-full"><div class="flex flex-col gap-2"><p class="whitespace-nowrap text-[24px] font-medium leading-8 tracking-[0.14px] text-[#1A1A1A]">${title}</p><p class="text-[14px] leading-5 text-black/45">${tagline}</p><div class="flex items-baseline"><span class="pt-1 text-[20px] font-medium">¥</span><span class="font-misans text-[48px] leading-[48px]">${shown}</span><span class="self-end text-[14px] leading-[22px]">/ 月</span><span class="self-end text-[14px] leading-[22px] text-[rgba(0,0,0,0.6)] line-through">¥${standard}</span></div><p class="shrink-0 text-[14px] leading-[22px] text-black/45">按年计费</p><span class="inline-flex items-center gap-0.5">${discount}</span><button class="ant-btn"><span>立即订阅</span></button></div></div><div class="flex flex-col gap-2">${line(
    "支持 V2.6 全新旗舰模型",
    "文本模型 / 全模态 / 语音",
  )}${line(credits, extra)}${line("支持主流编程框架", "OpenClaw / Codex / MiMo Claw 等")}${line(
    "夜间 0.8x 消耗",
    "00:00—08:00 · UTC+8",
  )}</div><div class="rounded-[8px] bg-black/5"><span>MiMo Claw</span><span>¥233.80 /年</span><p class="w-full break-words text-[12px] leading-4">专属龙虾 · 金山办公 · 多任务并行</p></div></div>`;
}

/** 混合页:四档卡 + 页脚噪音(邀请返现/工具矩阵/FAQ/版权)——验收问题二的回归锚,
 * 旧版按折叠文本切段会把页脚吞进末档权益 */
const XIAOMI_HTML = `<div>个人版 团队版 NEW 连续包月 首购优惠 连续包年88 折${[
  xmCard("Max", "高强度开发", "579", "659", "立减 960 元", "9840 亿 Credits", "= 20 x Lite"),
  xmCard("Pro", "专业开发", "289", "329", "立减 480 元", "4560 亿 Credits", "= 9.3 x Lite"),
  xmCard("Standard", "日常办公", "87", "99", "立减 144 元", "1320 亿 Credits", "= 2.7 x Lite"),
  xmCard("Lite", "轻量体验", "34", "39", "立减 60 元", "492 亿 Credits", "套餐年总量"),
].join(
  "",
)}<div>邀好友首单 9 折 ,您最高返实付 20% 首单返 10% · 邀请人为 Max / Standard 年费会员 立即邀请 编程工具支持 MiMo Desktop MiMo Code OpenCode OpenClaw Claude Code Codex 快速开始 订阅套餐 选择适合你的套餐并完成订阅 立即购买 常见问题 目前 Token Plan 有哪些订阅优惠？ 首购优惠：个人版首次购买享 88 折 Copyright©2026 Xiaomi. All Rights Reserved</div></div>`;

/** 百炼 Token Plan 概述页(2026-10-29 真实页折叠文本,保留两处陷阱:
 * ① 用量包「100 元/个/月」与团队版「元/座席/月」不得混入个人版定价;
 * ② 正文「Standard 与 Pro 套餐附赠…」是散落提及,不得多算档位) */
const BAILIAN_TOKEN_HTML =
  "<div>个人版 Lite 套餐 Essential 套餐 Standard 套餐 Pro 套餐 用量包 定价 原价 60 元/月 限时 39 元/月 原价 120 元/月 限时 79 元/月 原价 180 元/月 限时 139 元/月 原价 600 元/月 限时 499 元/月 100 元/个/月 20,000 Credits/个 最多同时持有 5 个 每月限额 11,500 Credits 25,500 Credits 45,000 Credits 180,000 Credits 不计入套餐月限额 并发 Agent 1-2 个 2-3 个 3-4 个 6-8 个 - Harness 权益 Standard 与 Pro 套餐附赠 AgentStudio 工具免费额度与折扣,不占 Credits 团队版 标准座席 Standard 高级座席 Pro 尊享座席 Max 共享用量包 Extra Bundle 定价 原价 198 元/座席/月 限时 150 元/座席/月 原价 698 元/座席/月 限时 550 元/座席/月</div>";

describe("新三源解析(M56 三渠道扩容)", () => {
  it("MiniMax 双态:年付标准/促销分离,月付价并入;权益整段直出", () => {
    const rows = parseMiniMaxCoding(
      { yearly: MM_YEARLY, monthly: MM_MONTHLY },
      "https://www.minimax.cn/m-plan",
      NOW,
    );
    expect(rows.map((r) => r.planName)).toEqual([
      "MiniMax M Plan · Go",
      "MiniMax M Plan · Explore",
      "MiniMax M Plan · Build",
    ]);
    expect(rows[0]).toMatchObject({
      vendor: "MiniMax 稀宇科技",
      currency: "CNY",
      monthlyFee: 49, // 月付标准价(首月 5 折 24.5 入 billingNote)
      yearlyFee: 588, // 划线价即标准年付(促销 490 入 billingNote)
      quarterlyFee: null,
      bestFor: "轻松上手",
    });
    expect(rows[0]!.billingNote).toBe(
      "年付标准 ¥588/年(促销 ¥490/年);月付 ¥49/月(限时首月5折 ¥24.5)",
    );
    // 权益=本卡 article 逐条原文,不跨档
    expect(rows[0]!.benefits).toEqual(["更多用量", "文本模型，如 M3.1 Flash", "图像和声音模型"]);
    expect(rows[1]!.benefits![0]).toBe("Go 的 3 倍用量");
    expect(rows[1]!.benefits![0]).not.toContain("更多用量");
    expect(rows[2]).toMatchObject({ monthlyFee: 469, yearlyFee: 5628 });
  });

  it("小米:展示价=年付折合月,划线价=连续包月标准;权益按卡内明细行配对", () => {
    const rows = parseXiaomiToken(XIAOMI_HTML, "https://platform.xiaomimimo.com/token-plan", NOW);
    expect(rows.map((r) => r.planName)).toEqual([
      "MiMo Token Plan · Max",
      "MiMo Token Plan · Pro",
      "MiMo Token Plan · Standard",
      "MiMo Token Plan · Lite",
    ]);
    expect(rows[0]).toMatchObject({
      vendor: "小米 MiMo",
      monthlyFee: 659, // 连续包月标准价(划线价)
      yearlyFee: 579, // 年付折合月
      quotaDesc: "9840 亿 Credits(= 20 x Lite)",
      offPeakRate: "谷 0.8×",
      bestFor: "高强度开发",
    });
    // 折扣口径取页签原文(88 折),不按取整后的展示价反推(会漂成 87 折)
    expect(rows[0]!.billingNote).toBe(
      "连续包年 88 折折合 ¥579/月(连续包月 ¥659/月);按年计费立减 960 元",
    );
    // 主行+次行配对;每卡只取本卡明细,不跨卡
    expect(rows[0]!.benefits).toEqual([
      "支持 V2.6 全新旗舰模型(文本模型 / 全模态 / 语音)",
      "9840 亿 Credits(= 20 x Lite)",
      "支持主流编程框架(OpenClaw / Codex / MiMo Claw 等)",
      "夜间 0.8x 消耗(00:00—08:00 · UTC+8)",
    ]);
  });

  it("小米页脚不进权益(验收问题二回归:旧版切段吞整页页脚)", () => {
    const rows = parseXiaomiToken(XIAOMI_HTML, "https://platform.xiaomimimo.com/token-plan", NOW);
    const all = rows.flatMap((r) => r.benefits ?? []).join("|");
    for (const noise of [
      "邀好友",
      "Copyright",
      "立即购买",
      "常见问题",
      "首购优惠",
      "加购",
      "MiMo Claw ¥",
    ]) {
      expect(all).not.toContain(noise);
    }
    expect(rows.every((r) => r.quotaDesc.includes("Credits"))).toBe(true);
  });

  it("百炼 Token Plan 个人版四档:原价入 fee/限时价入注记;用量包与团队座席不入库", () => {
    const rows = parseBailianToken(
      BAILIAN_TOKEN_HTML,
      "https://help.aliyun.com/zh/model-studio/token-plan-overview",
      NOW,
    );
    expect(rows.map((r) => r.planName)).toEqual([
      "百炼 Token Plan · Lite",
      "百炼 Token Plan · Essential",
      "百炼 Token Plan · Standard",
      "百炼 Token Plan · Pro",
    ]);
    expect(rows[0]).toMatchObject({
      vendor: "阿里云百炼",
      currency: "CNY",
      monthlyFee: 60, // 原价(限时 39 入注记)
      quarterlyFee: null,
      yearlyFee: null,
      billingNote: "限时优惠 ¥39/月(原价 ¥60/月)",
      quotaDesc: "11,500 Credits/月",
      note: "仅支持华北2(北京)地域",
    });
    expect(rows[3]).toMatchObject({ monthlyFee: 600, quotaDesc: "180,000 Credits/月" });
    expect(rows[0]!.benefits).toEqual([
      "每月限额 11,500 Credits",
      "并发 Agent 1-2 个",
      "文本/图像/视频/语音模型与模型内置工具统一按 Credits 抵扣",
    ]);
    // Standard/Pro 独有 AgentStudio 附赠(官方原文)
    expect(rows[2]!.benefits).toHaveLength(4);
    expect(rows[2]!.benefits![3]).toBe("附赠 AgentStudio 工具额度与折扣");
  });

  it("百炼 Token Plan 结构错位(改版)抛错,不静默错配价格", () => {
    expect(() => parseBailianToken("<p>Lite 套餐</p>", "https://x/", NOW)).toThrow(
      "bailian token 结构未匹配",
    );
  });
});
