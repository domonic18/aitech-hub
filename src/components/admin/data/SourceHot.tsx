/**
 * 数据中心·源管理热榜源视图(M34 批③ 第三轮→数据壳重组迁入):
 * insight_hot_source 台账 + 行内启停;拉取闸与回写语义在 lib/insight/hot-source。
 */
import HotSourceLedger from "@/components/admin/spider/HotSourceLedger";
import { listHotSourcesAdmin } from "@/lib/insight/hot-source";

export default async function SourceHot(): Promise<React.ReactElement> {
  const rows = await listHotSourcesAdmin();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">热榜源</h2>
        <p className="mt-0.5 text-xs text-text-3">
          外部热榜拉取源登记台账:行内启停即生效(缺行=启用),连败≥3 标红;
          拉取排程见「运行·计划」,信号产出见「洞察」。
        </p>
      </div>
      <HotSourceLedger rows={rows} />
    </div>
  );
}
