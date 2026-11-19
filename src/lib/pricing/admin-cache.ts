/**
 * 公开页即时再验证(M56 验收反馈一:终审后 /pricing/ 被 ISR 600s 挡住,
 * 空态误导「未上架」;管理侧任何行变更统一刷公开页。爬虫只产 pending
 * 不影响公开面,不需触发)。
 *
 * 单点出口:管理侧各写操作(模型面/套餐面/按源下架)都调它,免得漏一处。
 */
import { revalidatePath } from "next/cache";

export function revalidatePublicPricing(): void {
  revalidatePath("/pricing/");
}
