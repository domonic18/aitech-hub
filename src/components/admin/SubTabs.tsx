/**
 * admin 通用二级切换条(?t= 子段;P2-17 自 admin/data 上移——posts 文章/分类
 * 双视图同样消费,非数据域私有):纯服务端链接条,
 * active 由当前段号判定,无客户端钩子;样式与 AdminTabNav 同一套视觉语言。
 * 段名钳制统一走 ./subtab#parseSubTab。
 */
import Link from "next/link";

export default function SubTabs({
  tabs,
  active,
  basePath,
}: {
  /** [段名, 标签] 有序对 */
  tabs: readonly (readonly [string, string])[];
  active: string;
  basePath: string;
}): React.ReactElement {
  return (
    // 窄屏:段名不折字(逐字换行会变成「种子/词库」两行),放不下改横向滚动
    <div className="flex max-w-full self-start overflow-x-auto rounded-sm border border-line">
      {tabs.map(([key, label]) => (
        <Link
          key={key}
          href={`${basePath}?t=${key}`}
          className={`shrink-0 border-r border-line px-2.5 py-2 text-[12.5px] whitespace-nowrap last:border-r-0 sm:px-4 sm:text-[13px] ${
            key === active
              ? "bg-accent-dim font-semibold text-accent"
              : "bg-panel text-text-2 hover:bg-panel-2"
          }`}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
