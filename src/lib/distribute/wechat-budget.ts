/**
 * 公众号正文码点预算计量(M30 批③):与推送管线同口径——renderWechatHtml
 * 内联样式版 HTML 全文按码点计([...html].length,上限 WECHAT_CONTENT_MAX_CHARS,
 * 校验点 wechat-sync-run)。纯函数无 IO;agent 落稿前自查工具与同步弹窗实时
 * 计数共用。实证锚(2026-10-14):样式属性约占 2/3、表格约 1/4、纯文本仅
 * ~16%,故分解给出 纯文本/表格/其余标记 三段,提示「别按文字数估」。
 */
import { WECHAT_CONTENT_MAX_CHARS } from "./channels";
import { renderWechatHtml } from "./wechat-html";

export interface WechatBudget {
  /** 全文码点(与 syncOnePost 码点检查同口径) */
  totalChars: number;
  limit: number;
  /** 去标签纯文本码点(读者实际读到的文字) */
  plainChars: number;
  /** <table>…</table> 段码点合计(每张约 2200,超预算优先砍表) */
  tableChars: number;
  /** 标签与内联样式属性码点 = total - plain */
  markupChars: number;
  overBudget: boolean;
  /** 0-100,超 85 即逼近,提示先精简再交稿 */
  usagePct: number;
}

/** 计量(渲染永不抛;themeId 未知/缺省回退默认主题,与管线一致) */
export function measureWechatBudget(contentMd: string, themeId?: string | null): WechatBudget {
  const { html } = renderWechatHtml(contentMd, themeId);
  const totalChars = [...html].length;
  const plainChars = [...html.replace(/<[^>]+>/g, "")].length;
  const tableChars = [...(html.match(/<table[\s\S]*?<\/table>/gi) ?? []).join("")].length;
  return {
    totalChars,
    limit: WECHAT_CONTENT_MAX_CHARS,
    plainChars,
    tableChars,
    markupChars: totalChars - plainChars,
    overBudget: totalChars > WECHAT_CONTENT_MAX_CHARS,
    usagePct: Math.round((totalChars / WECHAT_CONTENT_MAX_CHARS) * 100),
  };
}
