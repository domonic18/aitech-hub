"use client";

/**
 * 主题胶囊(DESIGN-SPEC §5):44×24 分段滑块,左月右日;状态 localStorage("ah-theme")。
 * M4 默认 light(前台 M3 暗色回补在二期),二期 Hub 切换时改默认 dark(arch/07 §5)。
 */
import { useEffect, useState } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "ah-theme";

export default function ThemeToggle(): React.ReactElement {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  const toggle = (): void => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? "切换到明亮主题" : "切换到暗黑主题"}
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
