/**
 * 展示卡公共 chrome(P2-14d 自 技术债评审 收敛:ProjectsView 项目卡
 * 与 /topics/ 专题卡同一骨架——图标+标题+右上徽章 + line-clamp 描述 + 底边线
 * footer 行 + hover 显形箭头):
 * - badge 为完整节点槽(项目=star 计数器,专题=蓝系 tag 章,样式各自独立);
 * - children 槽承接描述与底边线之间的附加行(项目卡的语言/话题 chips);
 * - footer 为底边线行左侧内容,footerAction 为右侧 hover 箭头文本
 *   (ml-auto + opacity-0 → group-hover 显形由本件统一);
 * - lines 字面类二选一(line-clamp-2/3),防动态拼类被 Tailwind 裁剪。
 * 纯展示 RSC;卡壳 <Link> 与悬停配色统一在此。
 */
import Link from "next/link";
import type { ReactNode } from "react";

export function ShowcaseCard({
  href,
  icon,
  title,
  titleClassName,
  badge,
  description,
  lines = 3,
  children,
  footer,
  footerClassName,
  footerAction,
}: {
  href: string;
  /** 图标 sprite id(如 "#i-code") */
  icon: string;
  title: string;
  /** 标题附加类(项目卡 font-mono;专题卡缺省无) */
  titleClassName?: string;
  /** 右上徽章节点(含自身 ml-auto 定位样式) */
  badge: ReactNode;
  description?: string | null;
  /** 描述截断行数(项目卡 2 行 / 专题卡 3 行) */
  lines?: 2 | 3;
  /** 描述与底边线之间的附加行(项目卡语言/话题 chips) */
  children?: ReactNode;
  /** 底边线行左侧内容(「配套文章 ×N」/ icon+「进入专题」) */
  footer: ReactNode;
  /** 底边线行附加类(项目卡 gap-4 font-mono;专题卡 gap-1) */
  footerClassName?: string;
  /** 右侧 hover 箭头内容(「详情 →」/「→」) */
  footerAction: ReactNode;
}): React.ReactElement {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-lg border border-line bg-panel p-4 shadow-sm transition-colors hover:border-accent/40 hover:bg-panel-2"
    >
      <span className="flex items-center gap-2">
        <svg className="ic flex-none text-accent" aria-hidden="true">
          <use href={icon} />
        </svg>
        <span
          className={`truncate text-[13.5px] font-semibold text-text-1 group-hover:text-accent-hover${titleClassName ? ` ${titleClassName}` : ""}`}
        >
          {title}
        </span>
        {badge}
      </span>
      {description ? (
        <span
          className={`mt-2 ${lines === 2 ? "line-clamp-2" : "line-clamp-3"} text-[12.5px] leading-relaxed text-text-3`}
        >
          {description}
        </span>
      ) : null}
      {children}
      <span
        className={`mt-3 flex items-center border-t border-line/55 pt-2.5 text-[11.5px] text-text-3${footerClassName ? ` ${footerClassName}` : ""}`}
      >
        {footer}
        <span className="ml-auto inline-flex flex-none items-center gap-1 text-accent opacity-0 transition-opacity group-hover:opacity-100">
          {footerAction}
        </span>
      </span>
    </Link>
  );
}
