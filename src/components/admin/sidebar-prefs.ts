/**
 * admin 侧栏宽度/收起偏好(2026-10-24 验收反馈问题三):localStorage 持久化,
 * AdminShell mount 后恢复(SSR 期回默认值,防水合错位)。收起宽与拖拽上下限
 * 在此单源(AdminSidebar 拖拽与 AdminShell 恢复钳制共用)。
 */

/** 展开态默认宽(与 globals.css --admin-sidebar-w 初始值一致) */
export const SIDEBAR_DEFAULT_W = 220;
/** 拖拽/恢复钳制下限(组标签 + 图标 + 文字的最小可读宽) */
export const SIDEBAR_MIN_W = 180;
/** 拖拽上限(再宽挤压内容区收益为负) */
export const SIDEBAR_MAX_W = 400;
/** 收起态图标栏宽(Tailwind lg:w-14) */
export const SIDEBAR_COLLAPSED_W = 56;

const STORAGE_KEY = "admin.sidebar";

export interface SidebarPrefs {
  /** 展开态宽度(收起态不存宽,恢复即回此宽) */
  w: number;
  collapsed: boolean;
}

export function loadSidebarPrefs(): SidebarPrefs {
  if (typeof window === "undefined") {
    return { w: SIDEBAR_DEFAULT_W, collapsed: false };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { w: SIDEBAR_DEFAULT_W, collapsed: false };
    const p = JSON.parse(raw) as Partial<SidebarPrefs>;
    const w =
      typeof p.w === "number" && Number.isFinite(p.w)
        ? Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, Math.round(p.w)))
        : SIDEBAR_DEFAULT_W;
    return { w, collapsed: p.collapsed === true };
  } catch {
    return { w: SIDEBAR_DEFAULT_W, collapsed: false };
  }
}

export function saveSidebarPrefs(p: SidebarPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式等存储不可用:偏好退化为会话内生效 */
  }
}
