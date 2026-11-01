/**
 * 公众号关键词直连(M66):命中即回固定内容(挂文章 or 自定义话术),
 * 不走检索/LLM——保住高频问题的确定性与延迟。RSC 取列表,客户端组件
 * 负责增删改并 router.refresh() 回读。
 */
import KeywordManager from "@/components/admin/wechat-mp/KeywordManager";
import { requireAdminPage } from "@/lib/auth/guard";
import { listKeywordsAdmin } from "@/lib/channel/wechat-mp/admin";

export const dynamic = "force-dynamic";

export default async function AdminWechatMpKeywordsPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const rows = await listKeywordsAdmin();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">关键词直连</h2>
        <p className="mt-0.5 text-xs text-text-3">
          用户消息包含关键词即回固定内容(文章优先,其次话术),命中后不走检索与 LLM
          生成——保住高频问题的确定性与延迟。按命中次数降序排列。
        </p>
      </div>

      <KeywordManager initial={rows} />

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:同关键词唯一;挂文章只对已发布文章生效(草稿不会出现在公众号回复里)。 API:GET/POST
        /api/wechat-mp/keywords · PUT/DELETE /api/wechat-mp/keywords/[id]。
      </p>
    </div>
  );
}
