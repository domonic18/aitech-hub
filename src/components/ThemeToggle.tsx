"use client";

/**
 * 主题胶囊(DESIGN-SPEC §5):44×24 分段滑块,左月右日。
 * 优先级与 layout 预置脚本同款:显式选择(localStorage ah-theme)> 系统偏好 > light;
 * 视觉态由 html[data-theme] 驱动(globals.css),本组件只维护 aria-pressed/title。
 */
import { useEffect, useState } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "ah-theme";

function readDomTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export default function ThemeToggle(): React.ReactElement {
  // SSR 无法预知真实主题(可能来自系统偏好),挂载后从 DOM 同步;
  // 无显式选择时系统实时变化由预置脚本改 DOM 并广播 ah-theme-change,在此再同步
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const sync = (): void => setTheme(readDomTheme());
    sync();
    window.addEventListener("ah-theme-change", sync);
    return () => window.removeEventListener("ah-theme-change", sync);
  }, []);

  const toggle = (): void => {
    // 以 DOM 实际值为基准翻转(旧实现读硬编码 state,暗色用户水合前点击会被吞)
    const next: Theme = readDomTheme() === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 隐私模式等存储不可用:仅当前页面生效,不报错
    }
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };

  const dark = theme === "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-pressed={dark}
      title={dark ? "切换到明亮主题" : "切换到暗黑主题"}
    >
      <span className="tt-track">
        <span className="tt-thumb" />
        <svg className="ic tt-ic tt-moon" aria-hidden="true">
          <use href="#i-moon" />
        </svg>
        <svg className="ic tt-ic tt-sun" aria-hidden="true">
          <use href="#i-sun" />
        </svg>
      </span>
    </button>
  );
}
