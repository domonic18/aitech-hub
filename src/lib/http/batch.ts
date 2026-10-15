/**
 * 批量操作路由共享件(M31 验收反馈:六后台面批量治理):ids 载荷 schema 与
 * 去重收口,防各路由字面量漂移。上限默认 200(与媒体 batch-delete 同口径;
 * 同步单事务循环可承受;更大批量走 job 化,见 seo-batch 范式)。
 */
import { z } from "zod";

export function batchIdsSchema(max = 200) {
  return z
    .array(z.string().regex(/^\d{1,19}$/))
    .min(1)
    .max(max);
}

/** {ids:[…]} 载荷对象壳(纯删除类路由 body 直用;带 action/status 的路由自行组 z.object) */
export function batchIdsBodySchema(max = 200) {
  return z.object({ ids: batchIdsSchema(max) });
}

/** 去重保序(幂等提交防重;客户端已 dedupe 仍兜底) */
export function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** 批量响应统一形状(updated=成功条数;skipped 列原因,客户端直呈) */
export interface BatchOutcome {
  updated: number;
  skipped: Array<{ id: string; reason: string }>;
}
