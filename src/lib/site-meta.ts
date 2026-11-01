/**
 * 站点品牌元数据(issue #203 收口):改了就要发版的那部分身份信息 ——
 * 品牌名、署名作者、默认描述、部署域名后缀。
 *
 * 与 lib/config/site-config.ts 的分工:那边是后台可改的 kv 配置(站点标题 / ICP /
 * hub 文案),这边是代码常量。此前品牌名与作者名在 layout / RSS / JSON-LD / 页脚 /
 * 页头 / 各页 description 里各写一遍,改一处漏一处会让页面文案与结构化数据打架
 * (JSON-LD 的 author 写死尤其要紧,属于署名与 E-E-A-T 的实质错误)。
 *
 * 消费面:根 layout metadata、feed.xml、文章/项目 JSON-LD、页脚版权行、
 * 页头域名后缀、各页 description 的品牌兜底。
 */
import { siteUrl } from "@/lib/seo/site";

/** 品牌名(后台未配置 site.title 时的站点标题,见 site-config#DEFAULT_SITE_TITLE) */
export const SITE_NAME = "一起AI";

/** 站点一句话定位(layout 默认标题后缀、页脚版权行) */
export const SITE_TAGLINE = "domonic18 的 AI 工程实战博客";

/** 站点默认描述(根 metadata、RSS channel description) */
export const SITE_DESCRIPTION =
  "一起AI:第一人称、可复现的 AI 工程实战原创博客,Claude Code / MCP / LLM 训练与评测等主题。";

/** 站长署名(JSON-LD author/publisher、页脚、项目页描述) */
export const AUTHOR_NAME = "domonic18";

/** 站长主页(GitHub 个人页) */
export const AUTHOR_URL = "https://github.com/domonic18";

/** 站点的「署名+链接」形态,JSON-LD 里反复出现,单点构造 */
export const AUTHOR_JSONLD = {
  "@type": "Person",
  name: AUTHOR_NAME,
  url: AUTHOR_URL,
} as const;

/** 品牌短名(终端风界面里的 user@host 提示行,如 `domonic18@17aitech`) */
export const SITE_BRAND_SHORT = "17aitech";

/** 部署域名(页头品牌 chip 右侧的 tld);随 NEXT_PUBLIC_SITE_URL,dev 即 localhost */
export function siteHost(): string {
  return new URL(siteUrl()).host;
}
