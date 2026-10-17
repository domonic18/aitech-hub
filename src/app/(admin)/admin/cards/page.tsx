/**
 * 卡片模板库页(M36 批①):文章图片卡 preset 的可视化调试台——模板迭代
 * 从「改代码→重合成一篇文章才能看到」变为「改模板/数据→本页刷新即见」。
 * 台账=presets 注册表(CARD_PRESET_IDS),预览与出图见 CardTemplateLab。
 */
import CardTemplateLab from "@/components/admin/cards/CardTemplateLab";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function AdminCardTemplatesPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">卡片模板库</h2>
        <p className="mt-0.5 text-xs text-text-3">
          文章图片卡的 preset 模板调试台:左侧选卡型,示例数据即时预览(与 agent 同一 zod 口径),「渲染
          PNG」走真实出图管线验证最终效果;模板迭代后刷新本页即见,无需盲调。
        </p>
      </div>
      <CardTemplateLab />
    </div>
  );
}
