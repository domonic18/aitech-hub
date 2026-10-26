/**
 * 博主候选批准自动登记(M26 批③追加,2026-10-12 拍板):approved 的 blogger
 * 候选同步 upsert social_account——取代此前「人工至博主管理登记」步(arch/02
 * 发现管线注记同步修订)。幂等键=unique(platform, secUid),已登记跳过且不
 * 覆盖既有昵称/启停;enabled=true 直接进采集轮询(批准即人工终审认可);
 * 登记失败不抛(返回 failed 供路由转行内提示),终审结论不受阻。
 */
import type { DiscoveryCandidate } from "@prisma/client";

import { isP2002, prisma } from "../db";
import { ensurePlatformRow } from "../telegram/social-platform-admin";

export type BloggerRegistration =
  | { outcome: "created"; socialAccountId: number }
  | { outcome: "exists"; socialAccountId: number }
  | { outcome: "failed"; message: string };

export async function registerApprovedBlogger(
  row: Pick<DiscoveryCandidate, "platform" | "externalId" | "author">,
): Promise<BloggerRegistration> {
  try {
    const platformRow = await ensurePlatformRow(row.platform);
    const secUid = row.externalId;
    const identity = { platform: row.platform, secUid };
    const existing = await prisma.socialAccount.findFirst({
      where: identity,
      select: { id: true },
    });
    if (existing) return { outcome: "exists", socialAccountId: existing.id };
    const created = await prisma.socialAccount.create({
      data: {
        platformRowId: platformRow.id,
        platform: row.platform,
        secUid,
        // 发现侧 author 可空;昵称为必填列,兜底「<platform>-<id>」供博主管理手动改
        nickname: row.author ?? `${row.platform}-${secUid}`,
        enabled: true,
        remark: "发现治理批准自动登记",
      },
      select: { id: true },
    });
    return { outcome: "created", socialAccountId: created.id };
  } catch (e) {
    // 撞 (platform,secUid) 唯一键=并发重复登记,读侧幂等转 exists
    if (isP2002(e)) {
      const raced = await prisma.socialAccount.findFirst({
        where: { platform: row.platform, secUid: row.externalId },
        select: { id: true },
      });
      if (raced) return { outcome: "exists", socialAccountId: raced.id };
    }
    return {
      outcome: "failed",
      message: e instanceof Error ? e.message : "自动登记异常",
    };
  }
}
