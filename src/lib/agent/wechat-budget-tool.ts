/**
 * 公众号码点预算自查·admin 工具(M30 批③):落稿前对拟交 markdown 服务端
 * 真跑 renderWechatHtml 计码点(与推送管线同口径,非文字数估算),给总/纯
 * 文本/表格/标记四段分解与超限判定。种子 skill 码点预算段「落稿前用码点
 * 计量工具自查」即本工具。纵深防御同 topic-tools(admin 图独占 + 会话归属
 * fail-closed)。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { measureWechatBudget } from "../distribute/wechat-budget";
import { WECHAT_THEME_IDS } from "../distribute/wechat-themes";

import { adminThreadDeny, assertAdminThread } from "./admin-thread";

export const measureWechatBudgetTool = tool(
  async ({ content_md, theme }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return adminThreadDeny(config?.configurable?.thread_id, "wechat-budget");
    const b = measureWechatBudget(content_md, theme);
    const suggestion = b.overBudget
      ? `已超预算 ${b.totalChars - b.limit} 码点:优先删重复形容词与平行罗列(合并为递进句)、可留可不留的小节;每砍一张表格约省 2200 码点;精简后重新调用本工具复核,报不出达标数字不要交稿`
      : b.usagePct >= 85
        ? `已用 ${b.usagePct}% 预算,逼近上限:交稿前建议再压一轮(同上优先级),推送前仍有同步侧硬校验兜底`
        : `预算健康(${b.usagePct}%),可直接交稿`;
    return JSON.stringify({
      ok: true,
      total_chars: b.totalChars,
      limit: b.limit,
      plain_chars: b.plainChars,
      table_chars: b.tableChars,
      markup_chars: b.markupChars,
      over_budget: b.overBudget,
      suggestion,
    });
  },
  {
    name: "measure_wechat_budget",
    description:
      "计量公众号正文码点预算:对给定 markdown 服务端渲染内联样式 HTML 后按码点计" +
      "(与推送校验同口径;样式属性约占 2/3、表格约 1/4,别按文字数估)。返回总/" +
      "纯文本/表格/标记分解与超限判定。写公众号向文章时落稿前必调(超预算必精简后" +
      "复核);纯站内文章可跳过。",
    schema: z.object({
      content_md: z.string().min(1).max(100_000).describe("拟交正文全文(markdown)"),
      theme: z.enum(WECHAT_THEME_IDS).optional().describe("公众号主题(码点差异极小;不确定就省略)"),
    }),
  },
);

export const WECHAT_BUDGET_TOOLS = [measureWechatBudgetTool];
