/**
 * 模型面爬虫单测(M55 批C;M56 批B 分层,fixture 无真网 prisma mock 无真库):
 * DeepSeek 峰谷矩阵解析(sourceUrl 参数化)/ Kimi SSR 行直取 / 结构造版抛错 /
 * persistModelRows 初稿三规则(currency 随价格走)/ 待复核打标 / crawlModelSource。
 * 渠道编排(runPricingCrawl)在 source-registry.test。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const create = vi.fn();
const update = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    modelPricing: {
      findMany: (...a: unknown[]) => findMany(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import {
  crawlModelSource,
  parseDeepseek,
  parseMoonshot,
  persistModelRows,
  withRecheckMark,
} from "./crawlers";

const NOW = new Date("2026-10-28T00:00:00Z");
const DS_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";
const MS_URL = "https://platform.moonshot.cn/docs/pricing/chat";

/** 按 2026-10-28 真实页面文本折叠形(去 tag 后)构造 */
const DEEPSEEK_HTML = `<p>下表所列模型价格以"百万 tokens"为单位。</p>
<table><tr><td>百万tokens输入 （缓存命中） 空闲时段 0.02元 0.15元 高峰时段 0.04元 0.30元 百万tokens输入 （缓存未命中） 空闲时段 1元 4.5元 高峰时段 2元 9.0元 百万tokens输出 空闲时段 4元 13.5元 高峰时段 8元 27.0元</td></tr></table>`;

const MOONSHOT_HTML = `{rows:[[_jsx(_components.a,{href:\`/guide/kimi\`,children:\`kimi-k3.1-pro\`}),\`¥13.00 / MTok\`,\`¥68.00 / MTok\`,\`¥1.30 / MTok\`],
[_jsx(_components.a,{href:\`/guide/kimi-hs\`,children:\`kimi-k3.1-pro-highspeed\`}),\`¥26.00 / MTok\`,\`¥136.00 / MTok\`,\`¥2.60 / MTok\`]]}`;

describe("parseDeepseek", () => {
  it("标准牌价=高峰·缓存未命中(flash 2/8,pro 9/27);矩阵按模型(谷/峰)入 note;sourceUrl 随行", () => {
    const rows = parseDeepseek(DEEPSEEK_HTML, DS_URL, NOW);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      vendor: "DeepSeek 深度求索",
      modelKey: "deepseek-flash",
      inputPrice: 2,
      outputPrice: 8,
      region: "cn",
      currency: "CNY",
      sourceUrl: DS_URL,
    });
    expect(rows[1]).toMatchObject({ modelKey: "deepseek-v4-pro", inputPrice: 9, outputPrice: 27 });
    expect(rows[0]!.note).toContain("命中 0.02/0.04 未命中 1/2 输出 4/8");
    expect(rows[1]!.note).toContain("命中 0.15/0.30 未命中 4.5/9.0 输出 13.5/27.0");
    expect(rows[0]!.note).toContain("空闲=高峰半价");
  });

  it("结构改版(矩阵缺失)抛错——源失败可见不静默", () => {
    expect(() => parseDeepseek("<p>价格调整中</p>", DS_URL, NOW)).toThrow(
      "deepseek 矩阵结构未匹配",
    );
  });
});

describe("parseMoonshot", () => {
  it("序列化行直取:模型+输入/输出;speed 档保留由终审取舍", () => {
    const rows = parseMoonshot(MOONSHOT_HTML, MS_URL, NOW);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      vendor: "月之暗面 Moonshot",
      modelKey: "kimi-k3.1-pro",
      inputPrice: 13,
      outputPrice: 68,
      sourceUrl: MS_URL,
    });
    expect(rows[1]).toMatchObject({ modelKey: "kimi-k3.1-pro-highspeed", inputPrice: 26 });
  });

  it("结构改版(零命中)抛错", () => {
    expect(() => parseMoonshot("<p>无表格</p>", MS_URL, NOW)).toThrow("moonshot 行结构未匹配");
  });
});

describe("crawlModelSource", () => {
  it("static 取数+解析;非 static 拒绝;失败自吞带 error", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(DEEPSEEK_HTML, { status: 200 })) as typeof fetch;
    try {
      const ok = await crawlModelSource("static", DS_URL, (h, u, n) => parseDeepseek(h, u, n), NOW);
      expect(ok.ok).toBe(true);
      expect(ok.rows).toHaveLength(2);
      const bad = await crawlModelSource(
        "rendered",
        DS_URL,
        (h, u, n) => parseDeepseek(h, u, n),
        NOW,
      );
      expect(bad.ok).toBe(false);
      expect(bad.error).toContain("不支持 kind");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("取数失败(http 非 200/网络)自吞 error 可见", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response("busy", { status: 503 })) as typeof fetch;
    try {
      const r = await crawlModelSource("static", DS_URL, (h, u, n) => parseDeepseek(h, u, n), NOW);
      expect(r.ok).toBe(false);
      expect(r.error).toContain("503");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("withRecheckMark", () => {
  it("前缀打标;旧标替换不叠加;超 200 截断", () => {
    expect(withRecheckMark(null, NOW)).toBe("【待复核 2026-10-28 爬取失败】");
    expect(withRecheckMark("官方牌价页直读", NOW)).toBe(
      "【待复核 2026-10-28 爬取失败】官方牌价页直读",
    );
    const remarked = withRecheckMark("【待复核 2026-10-21 爬取失败】旧 note", NOW);
    expect(remarked).toBe("【待复核 2026-10-28 爬取失败】旧 note");
    expect(remarked).not.toContain("2026-10-21");
    expect(withRecheckMark("长".repeat(300), NOW)).toHaveLength(200);
  });
});

describe("persistModelRows 初稿三规则", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const rows = parseDeepseek(DEEPSEEK_HTML, DS_URL, NOW);

  it("不存在→建 pending;pending→刷新(currency 随价格走);enabled→不动", async () => {
    findMany.mockResolvedValue([
      { id: BigInt(7), vendor: "DeepSeek 深度求索", modelKey: "deepseek-flash", status: "pending" },
      {
        id: BigInt(8),
        vendor: "DeepSeek 深度求索",
        modelKey: "deepseek-v4-pro",
        status: "enabled",
      },
    ]);
    update.mockResolvedValue({ id: BigInt(7) });
    const t = await persistModelRows(rows);
    expect(t).toMatchObject({ created: 0, refreshed: 1, untouched: 1, failed: 0 });
    const upd = update.mock.calls[0]![0] as {
      where: { id: bigint };
      data: { status?: string; currency?: string };
    };
    expect(upd.where.id).toBe(BigInt(7));
    expect(upd.data.status).toBeUndefined(); // 刷新不触状态机
    expect(upd.data.currency).toBe("CNY"); // currency 随价格走(跨通道脏态防线)
  });

  it("陌生模型→create 落 pending;单行落库失败自吞计数", async () => {
    findMany.mockResolvedValue([]);
    create.mockRejectedValueOnce(new Error("db boom")).mockResolvedValue({ id: BigInt(2) });
    const t = await persistModelRows(rows);
    expect(t).toMatchObject({ created: 1, failed: 1 });
    const arg = create.mock.calls[1]![0] as { data: { status: string; currency: string } };
    expect(arg.data.status).toBe("pending");
    expect(arg.data.currency).toBe("CNY");
  });
});
