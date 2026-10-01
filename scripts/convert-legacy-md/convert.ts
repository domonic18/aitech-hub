/**
 * contentHtml → contentMd 转换规则(M5-d;纯函数,无 IO)。
 * 输入约束:contentHtml 已经 clean-html.ts 白名单清洗(标签白名单 + code 仅留
 * `language-*` class + img/a 内链相对化),故这里不需要再做安全处理——turndown
 * 输出的是 Markdown 纯文本,前台经 react-markdown 渲染,与富文本粘贴同链。
 */
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export interface ConvertResult {
  contentMd: string;
  /** 降级点告警(内容仍在,形态有损),供 --dry-run 与汇总报告 */
  warnings: string[];
}

export function createConverter(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  // GFM:表格 / 删除线 / 任务列表 / language-* 围栏代码块
  td.use(gfm);

  // figure → 图片 + figcaption 斜体行([caption] 短码在清洗阶段已归一成该结构)
  td.addRule("figure", {
    filter: "figure",
    replacement: (_content, node) => {
      const img = node.querySelector("img");
      const cap = node.querySelector("figcaption");
      const src = img?.getAttribute("src") ?? "";
      const alt = img?.getAttribute("alt") ?? "";
      const imgMd = src ? `![${alt}](${src})` : "";
      const capText = cap?.textContent?.trim() ?? "";
      return capText ? `${imgMd}\n\n*${capText}*` : imgMd;
    },
  });

  // iframe(清洗后仅剩 B 站/YouTube 域白名单播放器)→ 链接占位,内容不丢
  td.addRule("iframe", {
    filter: "iframe",
    replacement: (_content, node) => {
      const src = node.getAttribute("src") ?? "";
      return src ? `\n\n[▶ 视频](${src})\n\n` : "";
    },
  });

  return td;
}

export function convertHtmlToMd(td: TurndownService, html: string): ConvertResult {
  const contentMd = td.turndown(html);
  const warnings: string[] = [];
  // 清洗阶段 data:URI 剥 src 的图会转出空引用:内容未丢,提醒人工补图
  if (contentMd.includes("]()")) warnings.push("存在空 src 图片引用(原 data:URI 图未落盘)");
  return { contentMd, warnings };
}
