"use client";

/**
 * admin 侧栏(DESIGN-SPEC §5 admin 侧栏 v2,220px):分组 + 图标 + 二期/M5 tag。
 * 未交付项一律禁用态展示(降级注记,不静默消失),不挂死链接。
 * M13 移动端:<1024 抽屉化(受控 open,开/关由 AdminShell 持有);
 * ≥1024(lg)固定常驻原样。隐藏走 -translate-x-full 而非 hidden,保留滑动动画。
 * 宽度/收起(2026-10-24 验收反馈问题三):lg 下右缘拖拽调宽(180–400,双击
 * 复位,持久化在 AdminShell);「«/»」收起为 56px 图标栏(标签 lg:hidden、
 * 图标居中,title 提示;移动抽屉不受影响)。偏好与钳制常量见 ./sidebar-prefs。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

import { SIDEBAR_DEFAULT_W, SIDEBAR_MAX_W, SIDEBAR_MIN_W } from "@/components/admin/sidebar-prefs";

type Item = { icon: string; label: string; href?: string; tag?: "M5" | "二期"; exact?: boolean };
type Group = { label: string; items: Item[] };

/**
 * IA v2(Ardot F12 定稿,创作域对齐批 2026-10-23):按内容漏斗 7 组 19 项。
 * 创作组置顶(漏斗起点);素材/内容拆两组;内容分发→分发中心独立组(更名,路由不动);
 * 洞察中心暂指数据壳洞察页签——洞察域立项迁 /admin/insight 时只改此项 href;
 * 用户+系统合并「用户与系统」,设置锚底。
 */
const GROUPS: ReadonlyArray<Group> = [
  {
    label: "OVERVIEW",
    items: [
      // exact:/admin 是所有后台路由的前缀,只按全等点亮,
      // 否则任何 /admin/xxx 页都会让「站点统计」与激活项同时高亮(2026-10-05 反馈)
      { icon: "i-dashboard", label: "站点统计", href: "/admin", exact: true },
    ],
  },
  {
    label: "创作",
    items: [
      { icon: "i-folder", label: "创作中心", href: "/admin/studio" },
      // 配图工坊(M40):agent 配图产物的加工台固定入口,列表页落地
      { icon: "i-picture", label: "配图工坊", href: "/admin/illustration" },
      { icon: "i-picture", label: "媒体库", href: "/admin/media" },
    ],
  },
  {
    label: "内容",
    items: [
      // 文章分类已并入文章管理「分类」页签(验收二批①:分类少,不占一级导航)
      { icon: "i-filetext", label: "文章管理", href: "/admin/posts" },
      { icon: "i-comment", label: "评论管理", href: "/admin/comments" },
      // 贴图管理(M41):公众号小绿书图片帖工作台(流水线+组装台)
      { icon: "i-appstore", label: "贴图管理", href: "/admin/pins" },
      { icon: "i-send", label: "电报管理", href: "/admin/telegram" },
      // 牌价管理(M55 工具钩子,M56 验收 IA 归位 2026-10-29):/pricing/ 公开页
      // 的牌价策展面(双表终审+渠道管理)——内容策展队列维度,自「数据」组迁入
      { icon: "i-global", label: "牌价管理", href: "/admin/pricing" },
    ],
  },
  {
    label: "分发",
    items: [
      // 内容分发→分发中心(IA v2 更名,多渠道枢纽永久位;路由不变)
      { icon: "i-cloudupload", label: "分发中心", href: "/admin/distribute" },
      // 公众号会话(M66):公众号私信问答的处置面(会话/关键词/接入配置)
      { icon: "i-comment", label: "公众号会话", href: "/admin/wechat-mp" },
    ],
  },
  {
    label: "数据",
    items: [
      // 数据中心(IA v5 板定):纯采集执行域,页签 源管理/计划/运行;
      // 洞察拆独立域 /admin/insight,旧 308 承接
      { icon: "i-cloudserver", label: "数据中心", href: "/admin/data" },
      // 洞察中心(IA v5 板定):独立域(分析总览 + 发现),自数据壳迁出
      { icon: "i-aim", label: "洞察中心", href: "/admin/insight" },
    ],
  },
  {
    label: "AI 服务",
    items: [
      { icon: "i-robot", label: "模型配置", href: "/admin/models" },
      // 写作技能自「模型配置」第 4 页签提升为独立页(2026-10-16 验收反馈问题二)
      { icon: "i-filetext", label: "写作技能", href: "/admin/skills" },
      // 会话管理已并入 AI 用量壳「会话」页签(/admin/usage/sessions,侧栏精简批②)
      { icon: "i-piechart", label: "AI 用量", href: "/admin/usage" },
    ],
  },
  {
    label: "用户与系统",
    items: [
      { icon: "i-user", label: "用户管理", href: "/admin/users" },
      { icon: "i-comment", label: "反馈管理", href: "/admin/feedback" },
      { icon: "i-checkcircle", label: "支付订单", href: "/admin/pay/orders" },
      // 配置类五页(常规/邮件/飞书/支付/PAT)合并为壳层页签(侧栏精简批①)
      { icon: "i-setting", label: "系统设置", href: "/admin/settings" },
    ],
  },
];

export default function AdminSidebar({
  open,
  onClose,
  collapsed,
  width,
  onToggleCollapsed,
  onWidthChange,
}: {
  open: boolean;
  onClose: () => void;
  /** lg 收起态(56px 图标栏);移动抽屉不受影响 */
  collapsed: boolean;
  /** 当前展开宽(拖拽起点;持久化由 AdminShell 统一落盘) */
  width: number;
  onToggleCollapsed: () => void;
  onWidthChange: (w: number) => void;
}): React.ReactElement {
  const pathname = usePathname();
  // 拖拽会话(startX/startW 起点 + last 最新值,pointerup 复核钳制)
  const dragRef = useRef<{ startX: number; startW: number; last: number } | null>(null);

  // active 判定(IA v2):最长 href 命中优先——
  // /admin/insight/… 须点亮「洞察中心」而非「数据中心」
  // (/admin/data 是其前缀,朴素 startsWith 会双亮;exact 项仍只按全等参与)。
  const activeHref = GROUPS.flatMap((group) => group.items).reduce<string | undefined>(
    (best, item) => {
      if (item.href === undefined) return best;
      const hit = pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`));
      if (!hit) return best;
      return best === undefined || item.href.length > best.length ? item.href : best;
    },
    undefined,
  );

  // ── 宽度拖拽(lg 专属;capture 保证移出热区仍收 move) ──────────────────────
  const startResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: width, last: width };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const moveResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (d === null) return;
    d.last = Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, d.startW + (e.clientX - d.startX)));
    onWidthChange(d.last);
  };
  const endResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current === null) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <aside
      className={`fixed top-0 left-0 z-20 flex h-screen w-[220px] flex-col overflow-y-auto border-r border-line bg-panel transition-transform duration-200 lg:translate-x-0 ${
        collapsed ? "lg:w-14" : "lg:w-[var(--admin-sidebar-w)]"
      } ${open ? "translate-x-0" : "-translate-x-full"}`}
    >
      <div className="flex items-center gap-2 px-4 py-4">
        <span
          className={`inline-block h-4 w-2 bg-accent ${collapsed ? "lg:hidden" : ""}`}
          aria-hidden="true"
        />
        <span
          className={`min-w-0 truncate text-sm font-semibold tracking-wide ${
            collapsed ? "lg:hidden" : ""
          }`}
        >
          一起AI 控制台
        </span>
        {/* 收起/展开切换(lg 专属;收起态居中作图标栏头钮) */}
        <button
          type="button"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
          onClick={onToggleCollapsed}
          className={`hidden h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-2 hover:bg-panel-2 hover:text-text-1 lg:inline-flex ${
            collapsed ? "mx-auto" : "ml-auto"
          }`}
        >
          {collapsed ? "»" : "«"}
        </button>
        <button
          type="button"
          aria-label="关闭菜单"
          onClick={onClose}
          className="ml-auto cursor-pointer rounded-sm p-1 text-text-2 hover:bg-panel-2 hover:text-text-1 lg:hidden"
        >
          <svg className="ic" aria-hidden="true">
            <use href="#i-close" />
          </svg>
        </button>
      </div>

      <nav className="flex-1 px-2 pb-4">
        {GROUPS.map((group) => (
          <div key={group.label} className="mb-3">
            <div
              className={`px-2 py-1.5 font-mono text-[10px] tracking-[0.08em] text-text-3 uppercase ${
                collapsed ? "lg:hidden" : ""
              }`}
            >
              {group.label}
            </div>
            {group.items.map((item) => {
              const active = item.href !== undefined && item.href === activeHref;
              if (item.href) {
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] ${
                      collapsed ? "lg:justify-center" : ""
                    } ${
                      active
                        ? "bg-accent-dim font-medium text-accent"
                        : "text-text-2 hover:bg-panel-2 hover:text-text-1"
                    }`}
                  >
                    <svg className="ic" aria-hidden="true">
                      <use href={`#${item.icon}`} />
                    </svg>
                    <span className={`min-w-0 truncate ${collapsed ? "lg:hidden" : ""}`}>
                      {item.label}
                    </span>
                  </Link>
                );
              }
              return (
                <span
                  key={item.label}
                  aria-disabled="true"
                  title={`${item.tag} 交付`}
                  className={`flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-text-3 ${
                    collapsed ? "lg:justify-center" : ""
                  }`}
                >
                  <svg className="ic" aria-hidden="true">
                    <use href={`#${item.icon}`} />
                  </svg>
                  <span className={`min-w-0 truncate ${collapsed ? "lg:hidden" : ""}`}>
                    {item.label}
                  </span>
                  <span
                    className={`ml-auto shrink-0 rounded-sm bg-panel-2 px-1 py-px font-mono text-[10px] text-text-3 ${
                      collapsed ? "lg:hidden" : ""
                    }`}
                  >
                    {item.tag}
                  </span>
                </span>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-line px-4 py-3">
        <Link
          href="/"
          aria-label="返回前台站点"
          className={`text-xs text-text-2 hover:text-accent ${collapsed ? "lg:block lg:text-center" : ""}`}
        >
          ←<span className={collapsed ? "lg:hidden" : ""}> 返回前台站点</span>
        </Link>
      </div>

      {/* 宽度拖拽热区(右缘 6px,lg 专属;收起态隐藏防误拖) */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整侧栏宽度(双击复位)"
        title="拖拽调整宽度 · 双击复位"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onDoubleClick={() => onWidthChange(SIDEBAR_DEFAULT_W)}
        className={`group absolute inset-y-0 right-0 z-10 hidden w-1.5 cursor-col-resize touch-none select-none ${
          collapsed ? "" : "lg:block"
        }`}
      >
        <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-accent/60" />
      </div>
    </aside>
  );
}
