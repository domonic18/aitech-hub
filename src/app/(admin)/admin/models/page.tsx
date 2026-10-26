/**
 * AI 模型配置页(M8 批⑥建三 Tab;M30 批① 曾增 Agent 技能页签,2026-10-16
 * 验收反馈问题二技能提为独立页 /admin/skills 后还原三 Tab;原型
 * admin-models.html):模型条目台账 + ASR 渠道单例 + 四角色任务绑定。
 * API Key/cookie 同口径:服务端加密只写不读,界面仅回显脱敏掩码。
 */
import ModelsAdminApp from "@/components/admin/models/ModelsAdminApp";
import { requireAdminPage } from "@/lib/auth/guard";
import { getAsrConfigAdmin } from "@/lib/ai/asr-admin";
import { listBindingsAdmin } from "@/lib/ai/bindings-admin";
import { listModelsAdmin } from "@/lib/ai/models-admin";

export const dynamic = "force-dynamic";

export default async function AdminModelsPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const [models, asr, bindings] = await Promise.all([
    listModelsAdmin(),
    getAsrConfigAdmin(),
    listBindingsAdmin(),
  ]);
  return <ModelsAdminApp models={models} asr={asr} bindings={bindings} />;
}
