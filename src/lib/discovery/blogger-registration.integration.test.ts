/**
 * 博主候选批准自动登记集成测试(M26 批③追加;standard/01-testing:
 * *.integration.test.ts 同层,`npm run test:integration`,不进
 * test:unit/make check/CI——依赖 dev compose 的 PG)。覆盖:created 落库
 * (enabled=true/昵称取 author/remark 溯源)/重复登记幂等 exists 且不覆盖
 * 既有昵称与启停/author 缺省昵称兜底。前置:docker compose up -d postgres
 * && npx prisma migrate deploy;bilibili 平台行由 ensurePlatformRow 幂等
 * 落地(共享单例,清理不删);测试自清理 social_account 行。
 */
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";
import { registerApprovedBlogger } from "@/lib/discovery/blogger-registration";

const MID_MAIN = "it-m26-mid-9001";
const MID_FALLBACK = "it-m26-mid-9002";

afterAll(async () => {
  await prisma.socialAccount.deleteMany({ where: { secUid: { in: [MID_MAIN, MID_FALLBACK] } } });
});

describe("registerApprovedBlogger(批准博主候选自动登记)", () => {
  it("created:落库 enabled=true,昵称取 author,remark 溯源发现批准", async () => {
    const reg = await registerApprovedBlogger({
      platform: "bilibili",
      externalId: MID_MAIN,
      author: "it-m26-发现博主",
    });
    expect(reg.outcome).toBe("created");
    if (reg.outcome !== "created") return;
    const row = await prisma.socialAccount.findUniqueOrThrow({
      where: { platform_secUid: { platform: "bilibili", secUid: MID_MAIN } },
    });
    expect(row.id).toBe(reg.socialAccountId);
    expect(row.enabled).toBe(true);
    expect(row.nickname).toBe("it-m26-发现博主");
    expect(row.remark).toBe("发现治理批准自动登记");
    // 平台行经 ensurePlatformRow 落地且指向同一行
    const platformRow = await prisma.crawlSource.findUniqueOrThrow({
      where: { name: "social:bilibili" },
    });
    expect(row.platformRowId).toBe(platformRow.id);
  });

  it("exists:重复登记幂等,不覆盖既有昵称与启停", async () => {
    // 先改写既有行(模拟站长在博主管理手动改过),再重复登记
    await prisma.socialAccount.update({
      where: { platform_secUid: { platform: "bilibili", secUid: MID_MAIN } },
      data: { nickname: "it-m26-手动改名", enabled: false },
    });
    const reg = await registerApprovedBlogger({
      platform: "bilibili",
      externalId: MID_MAIN,
      author: "it-m26-发现博主",
    });
    expect(reg.outcome).toBe("exists");
    if (reg.outcome !== "exists") return;
    const row = await prisma.socialAccount.findUniqueOrThrow({
      where: { platform_secUid: { platform: "bilibili", secUid: MID_MAIN } },
    });
    expect(row.id).toBe(reg.socialAccountId);
    expect(row.nickname).toBe("it-m26-手动改名");
    expect(row.enabled).toBe(false);
    const count = await prisma.socialAccount.count({
      where: { platform: "bilibili", secUid: MID_MAIN },
    });
    expect(count).toBe(1);
  });

  it("author 缺省:昵称兜底「<platform>-<externalId>」", async () => {
    const reg = await registerApprovedBlogger({
      platform: "bilibili",
      externalId: MID_FALLBACK,
      author: null,
    });
    expect(reg.outcome).toBe("created");
    const row = await prisma.socialAccount.findUniqueOrThrow({
      where: { platform_secUid: { platform: "bilibili", secUid: MID_FALLBACK } },
    });
    expect(row.nickname).toBe(`bilibili-${MID_FALLBACK}`);
  });
});
