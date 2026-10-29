/**
 * 渠道注册表与编排单测(M56 批B,prisma mock + fetch 桩无真网):
 * syncPricingSources 幂等种子(只补缺不改值)/ listEnabledSources 启停+未知 key
 * 过滤 / runPricingCrawl 编排:URL 从 DB 行来(后台可调零发版)、启停渠道不跑、
 * 任一源失败整 job 上抛且失败源旧数据打待复核(成功源照常落库)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const srcUpsert = vi.fn();
const srcFindMany = vi.fn();
const srcFindUnique = vi.fn();
const findModels = vi.fn();
const createModel = vi.fn();
const updateModel = vi.fn();
const findPlans = vi.fn();
const createPlan = vi.fn();
const updatePlan = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    pricingSource: {
      upsert: (...a: unknown[]) => srcUpsert(...a),
      findMany: (...a: unknown[]) => srcFindMany(...a),
      findUnique: (...a: unknown[]) => srcFindUnique(...a),
    },
    modelPricing: {
      findMany: (...a: unknown[]) => findModels(...a),
      create: (...a: unknown[]) => createModel(...a),
      update: (...a: unknown[]) => updateModel(...a),
    },
    codingPlan: {
      findMany: (...a: unknown[]) => findPlans(...a),
      create: (...a: unknown[]) => createPlan(...a),
      update: (...a: unknown[]) => updatePlan(...a),
    },
  },
}));

import {
  listEnabledSources,
  runPricingCrawl,
  SOURCE_DEFS,
  syncPricingSources,
} from "./source-registry";

const NOW = new Date("2026-10-29T00:00:00Z");
const DS_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";
const MS_URL = "https://platform.moonshot.cn/docs/pricing/chat";
const KIMI_URL = "https://www.kimi.com/membership/pricing?from=kfc_membership_topbar";
const GLM_URL = "https://bigmodel.cn/glm-coding";

const DEEPSEEK_HTML = `<table><tr><td>百万tokens输入 （缓存命中） 空闲时段 0.02元 0.15元 高峰时段 0.04元 0.30元 百万tokens输入 （缓存未命中） 空闲时段 1元 4.5元 高峰时段 2元 9.0元 百万tokens输出 空闲时段 4元 13.5元 高峰时段 8元 27.0元</td></tr></table>`;
const MOONSHOT_HTML = `{rows:[[_jsx(_components.a,{href:\`/guide/kimi\`,children:\`kimi-k3.1-pro\`}),\`¥13.00 / MTok\`,\`¥68.00 / MTok\`,\`¥1.30 / MTok\`]]}`;

function kimiCard(title: string, tagline: string, amount: string, billingCycle?: string): string {
  return `<div class="plan-container plan"><div class="plan-title">${title}</div>
<p class="plan-tagline"><span>${tagline}</span></p>
<p class="plan-price"><span class="price-amount">${amount}</span><span class="price-suffix">/ 月</span></p>
${billingCycle === undefined ? "" : `<p class="plan-billing-cycle">${billingCycle}</p>`}
<div class="plan-features divider"><div class="plan-feature"><div class="markdown plan-feature-markdown"><div class="paragraph" dir="auto">2 倍 Agent 额度</div></div></div></div></div>`;
}

beforeEach(() => {
  vi.clearAllMocks();
  srcUpsert.mockResolvedValue({ id: BigInt(1) });
  process.env.CARD_RENDERER_URL = "http://card-renderer:8011";
});

describe("syncPricingSources", () => {
  it("按注册表逐个 upsert,只补缺不改值(update 为空)", async () => {
    const n = await syncPricingSources();
    expect(n).toBe(SOURCE_DEFS.length);
    expect(srcUpsert).toHaveBeenCalledTimes(SOURCE_DEFS.length);
    const first = srcUpsert.mock.calls[0]![0] as {
      where: { key: string };
      update: Record<string, unknown>;
      create: { key: string; url: string; enabled: boolean };
    };
    expect(first.where.key).toBe(SOURCE_DEFS[0]!.key);
    expect(Object.keys(first.update)).toHaveLength(0); // 后台字段不覆盖
    expect(first.create.enabled).toBe(true);
    expect(first.create.url).toBe(SOURCE_DEFS[0]!.defaultUrl);
  });
});

describe("listEnabledSources", () => {
  it("enabled+target 过滤;未知 key 跳过(代码侧未注册不跑)", async () => {
    // mock 模拟 prisma where 语义:仅返回 enabled 行
    srcFindMany.mockResolvedValue([
      { key: "deepseek", target: "model", kind: "static", url: DS_URL, enabled: true },
      { key: "legacy-gone", target: "model", kind: "static", url: "https://x", enabled: true },
    ]);
    const sources = await listEnabledSources("model");
    const where = srcFindMany.mock.calls[0]![0] as { where: { enabled: boolean; target: string } };
    expect(where.where).toMatchObject({ enabled: true, target: "model" });
    expect(sources.map((s) => s.key)).toEqual(["deepseek"]); // 未知 key 跳过
    expect(sources[0]!.url).toBe(DS_URL); // URL 来自 DB 行(后台可调零发版)
  });
});

describe("runPricingCrawl 编排", () => {
  function stubDb(): void {
    srcFindMany.mockImplementation((args: { where: { target: string } }) =>
      Promise.resolve(
        args.where.target === "model"
          ? [
              { key: "deepseek", target: "model", kind: "static", url: DS_URL, enabled: true },
              { key: "moonshot", target: "model", kind: "static", url: MS_URL, enabled: true },
            ]
          : [
              {
                key: "kimi-membership",
                target: "plan",
                kind: "rendered",
                url: KIMI_URL,
                enabled: true,
              },
              { key: "glm-coding", target: "plan", kind: "rendered", url: GLM_URL, enabled: true },
            ],
      ),
    );
    srcFindUnique.mockResolvedValue({ url: DS_URL });
    findModels.mockResolvedValue([]);
    findPlans.mockResolvedValue([]);
    createModel.mockResolvedValue({ id: BigInt(1) });
    updateModel.mockResolvedValue({ id: BigInt(1) });
    createPlan.mockResolvedValue({ id: BigInt(2) });
    updatePlan.mockResolvedValue({ id: BigInt(2) });
  }

  function stubFetch(opts: { deepseekFail?: boolean; kimiFail?: boolean } = {}): () => void {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/snapshot")) {
        if (opts.kimiFail === true) return new Response("busy", { status: 503 });
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          url?: string;
          clickText?: string;
        };
        if (body.url?.includes("kimi") === true) {
          return new Response(
            JSON.stringify({
              html:
                body.clickText === "连续包年"
                  ? kimiCard("Go", "日常使用", "39", "按年计费 ¥468")
                  : kimiCard("Go", "日常使用", "49"),
              finalUrl: body.url ?? "",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (body.url?.includes("bigmodel") === true) {
          const card = (t: string, s: string, o?: string): string =>
            `<div class="cp-card flex"><h3 class="cp-card__title">${t}</h3><p class="cp-card__description">日常使用</p><div class="cp-card__price-current"><span class="cp-card__price-amount">${s}</span></div>${
              o === undefined
                ? ""
                : `<div class="cp-card__price-original"><span>¥</span><span>${o}</span></div>`
            }<ul class="cp-card__features"><li class="cp-card__feature--highlight"><span class="cp-card__feature-text"> 每周 10,000 积分 </span></li></ul></div>`;
          const html =
            body.clickText === "连续包季"
              ? card("Lite", "44.1", "49")
              : body.clickText === "连续包年"
                ? card("Lite", "39.2", "49")
                : `<div>连续包季 9折 连续包年 8折</div>${card("Lite", "49")}`;
          return new Response(JSON.stringify({ html, finalUrl: body.url ?? "" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200 });
      }
      if (url.includes("deepseek")) {
        if (opts.deepseekFail === true) return new Response("busy", { status: 503 });
        return new Response(DEEPSEEK_HTML, { status: 200 });
      }
      if (url.includes("moonshot")) return new Response(MOONSHOT_HTML, { status: 200 });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    return () => {
      globalThis.fetch = orig;
    };
  }

  it("全源成功:URL 取自 DB 行;模型/套餐双面落库", async () => {
    stubDb();
    const cleanup = stubFetch();
    try {
      const s = await runPricingCrawl(NOW);
      expect(s.models).toMatchObject({ fetched: 3, created: 3, markedStale: 0 });
      expect(s.models.sources.every((x) => x.ok)).toBe(true);
      expect(s.plans.sources.map((x) => x.source)).toEqual(["kimi-membership", "glm-coding"]);
      expect(s.plans).toMatchObject({ created: 2, failed: 0, markedStale: 0 }); // Kimi Go 1 + GLM Lite 1(fixture 最小化)
      const planCreated = createPlan.mock.calls[0]![0] as {
        data: { planName: string; yearlyFee: number };
      };
      expect(planCreated.data.planName).toBe("Kimi 会员 · Go");
      expect(planCreated.data.yearlyFee).toBe(468); // 周期总价随行
    } finally {
      cleanup();
    }
  });

  it("任一源失败整 job 上抛(连败可见);成功源照常落库;失败源打待复核", async () => {
    stubDb();
    const cleanup = stubFetch({ deepseekFail: true, kimiFail: true });
    try {
      srcFindUnique
        .mockResolvedValueOnce({ url: DS_URL }) // deepseek 打标圈定 URL
        .mockResolvedValue({ url: KIMI_URL }); // kimi 打标圈定 URL
      findModels
        .mockResolvedValueOnce([]) // 模型落库圈定(deepseek 失败无 rows;moonshot ok 有 rows → 圈定在失败标记前)
        .mockResolvedValueOnce([{ id: BigInt(9), note: null }]); // deepseek 打标圈定
      findPlans.mockResolvedValue([]); // 套餐侧圈定(全空)
      updateModel.mockResolvedValue({ id: BigInt(9) });
      updatePlan.mockResolvedValue({ id: BigInt(31) });
      await expect(runPricingCrawl(NOW)).rejects.toThrow(
        /deepseek\(http 503\); kimi-membership\(snapshot http 503[^)]*\); glm-coding\(snapshot http 503[^)]*\);已标待复核 1 行/u,
      );
      // moonshot 成功数据不浪费;glm 照常 3 建
      expect(createModel).toHaveBeenCalledTimes(1);
      expect(createPlan).toHaveBeenCalledTimes(0); // glm 同拍 503(kimiFail 桩全局)
      const marks = updateModel.mock.calls.map(
        (c) => (c[0] as { data: { note: string } }).data.note,
      );
      expect(marks).toEqual(["【待复核 2026-10-29 爬取失败】"]);
    } finally {
      cleanup();
    }
  });

  it("停用渠道不跑(URL/启停后台可调零发版)", async () => {
    srcFindMany
      .mockResolvedValueOnce([
        { key: "deepseek", target: "model", kind: "static", url: DS_URL, enabled: true },
      ])
      .mockResolvedValueOnce([
        { key: "kimi-membership", target: "plan", kind: "rendered", url: KIMI_URL, enabled: true },
      ]);
    srcFindUnique.mockResolvedValue({ url: DS_URL });
    findModels.mockResolvedValue([]);
    findPlans.mockResolvedValue([]);
    createModel.mockResolvedValue({ id: BigInt(1) });
    createPlan.mockResolvedValue({ id: BigInt(2) });
    const cleanup = stubFetch();
    try {
      const s = await runPricingCrawl(NOW);
      expect(s.models.sources.map((x) => x.source)).toEqual(["deepseek"]);
      expect(s.plans.sources.map((x) => x.source)).toEqual(["kimi-membership"]);
    } finally {
      cleanup();
    }
  });
});
