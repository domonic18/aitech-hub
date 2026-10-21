/**
 * 卡片图渲染·admin 工具(M31 批B):agent 把编排的 HTML 渲染成图片入媒体库。
 * 单模 = 自由 HTML(服务端消毒;2026-10-20 起模板入口机制层关闭——两次指南
 * 调教后弱模型仍循省 token 惯性落 preset,用户裁定收掉工具面而非继续调指南:
 * schema 只留 html(≤30000 字符)+ width/maxHeight,preset/data 彻底移除;
 * preset 模板实现保留(写作配置面板配图样例预览用),版式设计知识转「版式
 * 语汇」住指南)。
 * token 纪律在工具层落地:html ≤30k 字符 zod 硬顶、返回极小 JSON、消毒/校验
 * 报错全部人话短句供自纠。渲染服务见 services/card-renderer。纵深防御同
 * wechat-budget/cover-tools(admin 图独占 + 会话归属 fail-closed)。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { renderCardPng } from "../card/render";
import { sanitizeCardHtml } from "../card/sanitize";
import { ACCENTS, pickAccent } from "../card/templates/shell";
import { uploadMedia } from "../media/service";

import { adminThreadDeny, assertAdminThread } from "./admin-thread";
import { RENDER_CARD_HTML_PLACEHOLDER } from "./context-trim";

const FREE_HTML_MAX_CHARS = 30_000; // 单卡硬顶(~8-10k token;多栏混排/示意图需要版面体量)

export const renderCardTool = tool(
  async ({ html, width, maxHeight }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return adminThreadDeny(config?.configurable?.thread_id, "card");

    // 占位回显防呆:上下文瘦身把旧调用的 args.html 换成了占位文本,模型偶尔
    // 原样抄回来再渲一次——渲出来就是一张写着占位语的无意义卡。措辞刻意说明
    // 「不是你的输入错误」:实测模型读到自己的历史占位会自判「我写漏了」而连环重渲。
    if ((html as string).includes(RENDER_CARD_HTML_PLACEHOLDER))
      return JSON.stringify({
        ok: false,
        error:
          "html 是系统为节省上下文做的压缩替换,不是你的输入错误,不要重渲。这张卡已有渲染结果," +
          "直接用前面工具结果里的 url;确实需要新卡时,重新写完整 HTML 再调用",
      });

    const r = sanitizeCardHtml(html as string);
    if (!r.ok) return JSON.stringify({ ok: false, error: r.error });

    try {
      // accent 按文章锚定:thread_id 作 seed,同篇恒同强调色组(跨篇轮换);
      // 回传给 agent——自由 HTML 据此与本篇其他卡同组。
      const accent = pickAccent(ACCENTS, config?.configurable?.thread_id ?? "preview");
      const card = await renderCardPng(r.html, {
        width: width ?? 900,
        ...(maxHeight !== undefined ? { maxHeight } : {}),
      });
      const media = await uploadMedia({
        data: card.png,
        mime: "image/png",
        filename: `card-${Date.now()}.png`,
      });
      return JSON.stringify({
        ok: true,
        url: media.path,
        markdown_line: `![](${media.path})`,
        width: card.width,
        height: card.height,
        accent,
        hint:
          "把 markdown_line 原样写入正文对应位置(独占一行,前后空行);落稿 save_topic_draft " +
          "时把本次全部卡片 url 逐个列入 card_urls,正文漏嵌会被拒绝;" +
          "强调色直接取本返回的 accent(main/soft/text 三色),与同篇其他卡恒同组",
      });
    } catch (e) {
      return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "渲染失败" });
    }
  },
  {
    name: "render_card",
    description:
      "把卡片渲染成图片并存入媒体库,返回 {url,width,height,accent},用于正文配图。唯一用法:" +
      "根据文章内容自己设计完整 HTML(≤30000 字符)一次交付——大数字指标区/双栏对照/" +
      "步骤链/时间线/泳道全景/金句大字/键值台账等版式语汇按内容形态选用,设计纪律与" +
      "「内容形态→版式语汇」对照以技能指南为准(内置模板模式已下线,不要尝试 preset/data " +
      "参数)。渲染端宽容:文档级标签(html/head/meta/title)自动摘除,写片段即可;深空" +
      "底色与字体已内置,强调色用返回的 accent(main/soft/text,与同篇其他卡恒同组);" +
      "纪律:<style> 块+class 复用样式,禁止逐元素重复 inline style、禁止手写 base64 图片," +
      "引已有配图用站内路径 /wp-content/uploads/…(渲染时自动映射媒体卷)。" +
      "返回的 url 直接以 ![](url) 写进正文,不要向用户复述 HTML。渲染成功即定稿:你" +
      "看不到成图,同一张卡至多再渲 1 次(工具报错或 height 异常时),禁止连环重渲。",
    schema: z.object({
      html: z
        .string()
        .min(1)
        .max(FREE_HTML_MAX_CHARS)
        .describe(
          "完整自由 HTML 片段(本工具唯一入参):按文章内容设计版式,html/head/meta/title " +
            "等文档级标签自动摘除,深空底色/字体已内置,强调色用返回的 accent;消毒不过会" +
            "整体报错,按报错修正重试",
        ),
      width: z
        .number()
        .int()
        .min(320)
        .max(1600)
        .optional()
        .describe("画布宽(px),默认 900;公众号场景 900 即可,多栏宽卡可 1000~1200"),
      maxHeight: z
        .number()
        .int()
        .min(400)
        .max(8000)
        .optional()
        .describe("画布高度上限(px),默认 4000;内容多时 4000~6000,超 8000 应拆成多张卡"),
    }),
  },
);

export const CARD_TOOLS = [renderCardTool];
