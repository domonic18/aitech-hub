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
  parseBailianCoding,
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

// ---------- 新三源 fixture(2026-10-29 真实快照文本裁剪) ----------

const MM_YEARLY =
  "M Plan Go For light use $264 $ 220 Per year, billed annually Purchase More usage Text models, e.g., M3.1 Flash Image and speech models Web search and multimodal understanding Explore For everyday use $648 $ 550 Per year, billed annually Purchase 3x Go usage Video models, e.g., H3 Build For heavy use $1,560 $ 1,320 Per year, billed annually Purchase 7.5x Go usage Priority access";
const MM_MONTHLY =
  "M Plan Go For light use $22 Per month, billed monthly Purchase More usage Explore For everyday use $55 Per month, billed monthly Purchase 3x Go usage Build For heavy use $130 Per month, billed monthly Purchase 7.5x Go usage";
const XIAOMI_HTML =
  "<div>Token Plan 连续包月 首购优惠 连续包年 88 折 Max 高强度开发 ¥ 579 / 月 ¥659 按年计费 立减 960 元 含 MiMo Claw 立即订阅 支持 V2.6 全新旗舰模型 文本模型 / 全模态 / 语音 9840 亿 Credits = 20 x Lite 支持主流编程框架 OpenClaw / Codex / MiMo Claw 等 TTS 模型免费 限时免费使用 夜间 0.8x 消耗 00:00—08:00 · UTC+8 畅快使用 无周限额 · 无 5 小时限额 Pro 专业开发 ¥ 289 / 月 ¥329 按年计费 立减 480 元 立即订阅 4560 亿 Credits = 9.3 x Lite Lite 轻量体验 ¥ 34 / 月 ¥39 按年计费 立减 60 元 立即订阅 492 亿 Credits 套餐年总量</div>";
const BAILIAN_HTML =
  "<div>价格 ¥ 200 /月 用量限制 每 5 小时 6,000 次请求 每周 45,000 次请求 每月 90,000 次请求 新客首月特惠: 首次订阅 Pro 套餐可享首月 ¥39.90(官网目录价 ¥200/月),后续按 ¥200/月 续费 支持的模型 推荐模型:qwen3.7-plus(支持图片理解)、qwen3.6-plus(支持图片理解)、kimi-k2.5、glm-5、MiniMax-M2.5 更多模型:qwen3.5-plus</div>";

describe("新三源解析(M56 三渠道扩容)", () => {
  it("MiniMax 双态:年付标准/促销分离,月付价并入;权益整段直出", () => {
    const rows = parseMiniMaxCoding(
      { yearly: MM_YEARLY, monthly: MM_MONTHLY },
      "https://www.minimax.io/m-plan",
      NOW,
    );
    expect(rows.map((r) => r.planName)).toEqual([
      "MiniMax M Plan · Go",
      "MiniMax M Plan · Explore",
      "MiniMax M Plan · Build",
    ]);
    expect(rows[0]).toMatchObject({
      vendor: "MiniMax 稀宇科技",
      currency: "USD",
      monthlyFee: 22,
      yearlyFee: 264, // 标准年付(促销 220 入 billingNote)
      quarterlyFee: null,
    });
    expect(rows[0]!.billingNote).toContain("促销 $220/年");
    expect(rows[0]!.benefits![0]).toContain("More usage");
  });

  it("小米单态:首价=年付折合月,次价=连续包月标准;Credits=额度口径", () => {
    const rows = parseXiaomiToken(XIAOMI_HTML, "https://platform.xiaomimimo.com/token-plan", NOW);
    expect(rows.map((r) => r.planName)).toEqual([
      "MiMo Token Plan · Max",
      "MiMo Token Plan · Pro",
      "MiMo Token Plan · Lite",
    ]);
    expect(rows[0]).toMatchObject({
      vendor: "小米 MiMo",
      monthlyFee: 659, // 连续包月标准价
      yearlyFee: 579, // 包年 88 折折合月
      quotaDesc: "9840 亿 Credits",
      offPeakRate: "谷 0.8×",
    });
    expect(rows[0]!.billingNote).toContain("88 折折合 ¥579/月");
  });

  it("百炼静态单档 Pro:¥200/月+首月特惠入 billingNote;推荐模型=权益", () => {
    const rows = parseBailianCoding(
      BAILIAN_HTML,
      "https://help.aliyun.com/zh/model-studio/coding-plan",
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vendor: "阿里云百炼",
      planName: "百炼 Coding Plan · Pro",
      monthlyFee: 200,
      quarterlyFee: null,
      yearlyFee: null,
      billingNote: "新客首月 ¥39.90(官网目录价 ¥200/月),后续按 ¥200/月 续费",
      quotaDesc: "每5小时6,000次请求每周45,000次请求每月90,000次请求",
    });
    expect(rows[0]!.benefits).toContain("qwen3.7-plus(支持图片理解)");
  });
});
