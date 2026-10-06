/**
 * 公众号正文主题注册表(M17 主题扩展,仿 md.openwrite.cn 多主题):
 * 强调元素(标题/加粗/引用框/行内码/链接角标)随主题变色,正文段落保持深灰
 * (可读性优先);代码块统一暗底不随主题(长代码对比度)。客户端安全零 IO
 * ——同步弹窗主题选择、配置卡默认主题与渲染管线共用同一份注册表。
 */

export const WECHAT_THEME_IDS = ["default", "green", "orange", "blue", "purple", "red"] as const;

export type WechatThemeId = (typeof WECHAT_THEME_IDS)[number];

export const WECHAT_THEME_DEFAULT: WechatThemeId = "default";

export interface WechatTheme {
  id: WechatThemeId;
  label: string;
  /** h1-h4 与降级加粗段的标题色 */
  heading: string;
  /** strong 加粗色 */
  strong: string;
  /** 引用框:左边框 / 底色 / 文字色 */
  quoteBorder: string;
  quoteBg: string;
  quoteText: string;
  /** 行内码文字色(底色统一淡灰) */
  inlineCode: string;
  /** 链接文字与 References 角标色 */
  link: string;
}

/** 色值贴近 md.openwrite.cn 常见主题色系;default 为 M17 初版黑白灰 */
export const WECHAT_THEMES: readonly WechatTheme[] = [
  {
    id: "default",
    label: "默认",
    heading: "#1f2328",
    strong: "#1f2328",
    quoteBorder: "#d0d7de",
    quoteBg: "#f6f8fa",
    quoteText: "#57606a",
    inlineCode: "#c7254e",
    link: "#576b95",
  },
  {
    id: "green",
    label: "青绿",
    heading: "#2b9939",
    strong: "#2b9939",
    quoteBorder: "#2b9939",
    quoteBg: "#f0f9f1",
    quoteText: "#3a7d44",
    inlineCode: "#1e7e34",
    link: "#2b9939",
  },
  {
    id: "orange",
    label: "暖橙",
    heading: "#d97c29",
    strong: "#d97c29",
    quoteBorder: "#e67e22",
    quoteBg: "#fdf6ee",
    quoteText: "#b9770e",
    inlineCode: "#c05f00",
    link: "#d97c29",
  },
  {
    id: "blue",
    label: "蔚蓝",
    heading: "#1e6bb8",
    strong: "#1e6bb8",
    quoteBorder: "#4a90d9",
    quoteBg: "#eef5fc",
    quoteText: "#2c6aa0",
    inlineCode: "#155fa0",
    link: "#1e6bb8",
  },
  {
    id: "purple",
    label: "雅紫",
    heading: "#7d3ba5",
    strong: "#7d3ba5",
    quoteBorder: "#9b59b6",
    quoteBg: "#f7f1fa",
    quoteText: "#7d3c98",
    inlineCode: "#6c3483",
    link: "#7d3ba5",
  },
  {
    id: "red",
    label: "朱红",
    heading: "#c7254e",
    strong: "#c7254e",
    quoteBorder: "#e74c3c",
    quoteBg: "#fdf0ef",
    quoteText: "#c0392b",
    inlineCode: "#c0392b",
    link: "#d03027",
  },
];

/** 按 id 取主题(未知 id 回退默认——历史脏数据/枚举演进兜底,渲染永不抛) */
export function getWechatTheme(id: string | null | undefined): WechatTheme {
  return WECHAT_THEMES.find((t) => t.id === id) ?? WECHAT_THEMES[0];
}
