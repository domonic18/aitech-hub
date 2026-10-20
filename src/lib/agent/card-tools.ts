/**
 * 卡片图渲染·admin 工具(M31 批B):agent 把编排的 HTML 渲染成图片入媒体库。
 * 双模:preset 数据卡(zod 校验数据→app 侧模板出 HTML,~300-600 token/卡,常规
 * 形态默认)与自由 HTML(服务端消毒,个性化版式——2026-10-20 起两条路径同等
 * 正式,html 上限 12k→30k 字符、新增 maxHeight,支撑多栏/混排/示意图)。
 * token 纪律在工具层落地:html ≤30k 字符 zod 硬顶、返回仅 {url,width,height}
 * 极小 JSON、消毒/校验报错全部人话短句供自纠。渲染服务见 services/card-renderer。
 * 纵深防御同 wechat-budget/cover-tools(admin 图独占 + 会话归属 fail-closed)。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { normalizePresetData } from "../card/normalize";
import { renderPreset, CARD_PRESET_IDS } from "../card/presets";
import { renderCardPng } from "../card/render";
import { sanitizeCardHtml } from "../card/sanitize";
import { ACCENTS, pickAccent } from "../card/templates/shell";
import { logger } from "../logger";
import { uploadMedia } from "../media/service";

import { adminThreadDeny, assertAdminThread } from "./admin-thread";
import { RENDER_CARD_HTML_PLACEHOLDER } from "./context-trim";

const FREE_HTML_MAX_CHARS = 30_000; // 单卡硬顶(~8-10k token;多栏混排/示意图需要版面体量)

export const renderCardTool = tool(
  async ({ preset, data, html, width, maxHeight }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return adminThreadDeny(config?.configurable?.thread_id, "card");

    // 模式路由:preset 与 html 二选一;data 仅随 preset
    if (preset && html) return JSON.stringify({ ok: false, error: "preset 与 html 只能二选一" });
    if (!preset && !html)
      return JSON.stringify({ ok: false, error: "必须提供 preset+data 或 html(二选一)" });
    if (preset && !data)
      return JSON.stringify({ ok: false, error: `使用 preset=${preset} 时必须提供 data 数据对象` });

    let doc: string;
    // accent 按文章锚定:thread_id 作 seed,同篇恒同强调色组(跨篇轮换);
    // 回传给 agent——自由 HTML 据此与本篇 preset 卡同组(此前模型只能盲猜)。
    const accent = pickAccent(ACCENTS, config?.configurable?.thread_id ?? "preview");
    if (preset) {
      // 漂移收编:弱模型的实证形态(单键包裹/字符串化 JSON/嵌套数组/二元数组行)
      // 归一层先还原再校验;命中即记日志观测漂移率,未知形态仍 fail-closed。
      const n = normalizePresetData(data);
      if (n.normalized) logger.warn({ event: "agent.card_args_normalized", preset });
      const r = renderPreset(preset, n.data, config?.configurable?.thread_id);
      if (!r.ok) {
        // 无效数据落日志(截断):此前失败侧零日志,每次排障都要翻 checkpoint。
        logger.warn({
          event: "agent.card_preset_invalid",
          preset,
          data: JSON.stringify(n.data).slice(0, 800),
        });
        return JSON.stringify({ ok: false, error: r.error });
      }
      doc = r.html;
    } else {
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
      doc = r.html;
    }

    try {
      const card = await renderCardPng(doc, {
        width: width ?? 900,
        ...(maxHeight !== undefined ? { maxHeight } : {}),
      });
      const media = await uploadMedia({
        data: card.png,
        mime: "image/png",
        filename: `card-${preset ?? "free"}-${Date.now()}.png`,
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
          "自由 HTML 的强调色直接取本返回的 accent(main/soft/text 三色),与同篇 preset 卡恒同组",
      });
    } catch (e) {
      return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "渲染失败" });
    }
  },
  {
    name: "render_card",
    description:
      "把卡片渲染成图片并存入媒体库,返回 {url,width,height,accent},用于正文配图(金句/要点/" +
      "数据/量级对比/台账/选型/步骤/全景/时间线/要素盘点/大图类内容优先做卡而非纯文字)。" +
      "内容形态→卡型的选型纪律以技能指南为准。两种用法二选一、同等正式:① preset+data" +
      "——内置模板(11 卡型统一深空主题:quote|points|stats|bars|ledger|compare|steps|" +
      "flow|timeline|matrix|photo),只填数据,样式模板兜底,常规形态默认;② html——" +
      "自由 HTML(≤30000 字符),多栏混排/图文并置/自定义示意图/数据对比长图首选。渲染端" +
      "宽容:文档级标签(html/head/meta/title)自动摘除,写片段即可;深空底色与字体已内置," +
      "强调色用返回的 accent(main/soft/text,与同篇 preset 卡恒同组);纪律:<style> 块+" +
      "class 复用样式,禁止逐元素重复 inline style、禁止手写 base64 图片," +
      "引已有配图用站内路径 /wp-content/uploads/…(渲染时自动映射媒体卷)。" +
      "返回的 url 直接以 ![](url) 写进正文,不要向用户复述 HTML。渲染成功即定稿:你" +
      "看不到成图,同一张卡至多再渲 1 次(工具报错或 height 异常时),禁止连环重渲。",
    schema: z.object({
      preset: z
        .enum(CARD_PRESET_IDS)
        .optional()
        .describe(
          "内置模板:quote=金句卡 points=要点列表 stats=数据指标 bars=量级条形 " +
            "ledger=键值台账 compare=双栏对比 steps=步骤流程 flow=泳道全景 " +
            "timeline=时间线 matrix=要素矩阵 photo=大图卡",
        ),
      data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "preset 的数据对象:quote={quote,author?};points={title?,points[2..8]:{text,icon?}};" +
            "stats={title?,items[2..6]:{value,label,delta?}}(首条自动放大为主指标,delta 如 " +
            "+23%/-12% 自动▲绿▼红);bars={title?,unit?,items[2..6]:{label,pct:1~100,value}}" +
            "(pct 为相对刻度,最大者 100);ledger={title?,rows[3..12]:{k,v}};" +
            "compare={title?,left:{label,items[1..6]},right:{label,items[1..6]},verdict?};" +
            "steps={title?,steps[2..8]:{title,detail?}};flow={title,subtitle?,lanes[2..4]:" +
            "{name,emoji?},phases[2..5]:{name,desc?},steps[3..16]:{text,lane,phase},summary?}" +
            "(lane/phase 为从 0 起下标,steps 数组序即全局流转编号);timeline={title?," +
            "events[2..8]:{time,text},summary?};matrix={title?,cells[2..8]:{name,desc?,icon?}};" +
            'photo={src:"/wp-content/uploads/…",title?,caption?}' +
            ";数组字段(points/items/rows/steps/lanes/phases/events/cells)一律直接传" +
            'JSON 数组,如 "rows":[{"k":"键","v":"值"}],不要包进对象',
        ),
      html: z
        .string()
        .max(FREE_HTML_MAX_CHARS)
        .optional()
        .describe(
          "自由 HTML 片段(与 preset 二选一;html/head/meta/title 等文档级标签自动摘除," +
            "深空底色/字体已内置,强调色用返回的 accent;消毒不过会整体报错,按报错修正重试)",
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
