/**
 * 卡片图渲染·admin 工具(M31 批B):agent 把编排的 HTML 渲染成图片入媒体库。
 * 双模:preset 数据卡(zod 校验数据→app 侧模板出 HTML,~300-600 token/卡,常规
 * 卡片优先)与自由 HTML(服务端消毒,~800-2000 token/卡,个性化排版)。
 * token 纪律三闸在工具层落地:html ≤12k 字符 zod 硬顶、返回仅 {url,width,height}
 * 极小 JSON、消毒/校验报错全部人话短句供自纠。渲染服务见 services/card-renderer。
 * 纵深防御同 wechat-budget/cover-tools(admin 图独占 + 会话归属 fail-closed)。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { normalizePresetData } from "../card/normalize";
import { renderPreset, CARD_PRESET_IDS } from "../card/presets";
import { renderCardPng } from "../card/render";
import { sanitizeCardHtml } from "../card/sanitize";
import { logger } from "../logger";
import { uploadMedia } from "../media/service";

import { adminThreadDeny, assertAdminThread } from "./admin-thread";

const FREE_HTML_MAX_CHARS = 12_000; // agent 输出 token 单卡硬顶(~3-4k token)

export const renderCardTool = tool(
  async ({ preset, data, html, width }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return adminThreadDeny(config?.configurable?.thread_id, "card");

    // 模式路由:preset 与 html 二选一;data 仅随 preset
    if (preset && html) return JSON.stringify({ ok: false, error: "preset 与 html 只能二选一" });
    if (!preset && !html)
      return JSON.stringify({ ok: false, error: "必须提供 preset+data 或 html(二选一)" });
    if (preset && !data)
      return JSON.stringify({ ok: false, error: `使用 preset=${preset} 时必须提供 data 数据对象` });

    let doc: string;
    if (preset) {
      // 漂移收编:弱模型会把数组包成 {"item":[…]} 单键对象(实证同 ask_user),
      // 归一层先还原再校验;命中即记日志观测漂移率,未知形态仍 fail-closed。
      const n = normalizePresetData(data);
      if (n.normalized) logger.warn({ event: "agent.card_args_normalized", preset });
      const r = renderPreset(preset, n.data);
      if (!r.ok) return JSON.stringify({ ok: false, error: r.error });
      doc = r.html;
    } else {
      const r = sanitizeCardHtml(html as string);
      if (!r.ok) return JSON.stringify({ ok: false, error: r.error });
      doc = r.html;
    }

    try {
      const card = await renderCardPng(doc, { width: width ?? 900 });
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
        hint:
          "把 markdown_line 原样写入正文对应位置(独占一行,前后空行);落稿 save_topic_draft " +
          "时把本次全部卡片 url 逐个列入 card_urls,正文漏嵌会被拒绝",
      });
    } catch (e) {
      return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "渲染失败" });
    }
  },
  {
    name: "render_card",
    description:
      "把卡片渲染成图片并存入媒体库,返回 {url,width,height},用于正文配图(金句/要点/" +
      "数据/量级对比/台账/选型/步骤/全景/时间线/要素盘点/大图类内容优先做卡而非纯文字)。" +
      "内容形态→卡型的选型纪律以技能指南为准。两种用法二选一:① preset+data——内置模板" +
      "(11 卡型双主题:观点/数据系深色 quote|points|stats|bars|ledger,流程/方法系浅色 " +
      "compare|steps|flow|timeline|matrix|photo),只填数据,样式模板兜底,常规卡片一律" +
      "优先(省额度);② html——自由 HTML(≤12000 字符,仅版式确需个性化时用),纪律:" +
      "<style> 块+class 复用样式,禁止逐元素重复 inline style、禁止手写 base64 图片," +
      "引已有配图用站内路径 /wp-content/uploads/…(渲染时自动映射媒体卷)。" +
      "返回的 url 直接以 ![](url) 写进正文,不要向用户复述 HTML。",
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
        .describe("自由 HTML(与 preset 二选一;消毒不过会整体报错,按报错修正重试)"),
      width: z
        .number()
        .int()
        .min(320)
        .max(1600)
        .optional()
        .describe("画布宽(px),默认 900;公众号场景 900 即可"),
    }),
  },
);

export const CARD_TOOLS = [renderCardTool];
