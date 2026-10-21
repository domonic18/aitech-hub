/**
 * 文生图插画·admin 工具(M39 批④):agent 依小节内容拟 prompt → illustrate
 * 角色绑定模型生图 → uploadMedia 入库,回传站内路径与 markdown 行。不交互不
 * 挂起(免确认口径同 cover auto 档):插画为点状增强、按张计费低成本,管理员
 * 在成稿评审时统一定夺去留。工艺分工纪律由工具描述承载:数据密集内容(价格
 * 表/对比/步骤/榜单)仍走 render_card HTML 信息卡——文生图对中文精确文字
 * 渲染不可靠是硬边界;未绑定/生图失败人话短句返回,模型改走 render_card 不
 * 阻塞其余小节。纵深防御同 card-tools(admin 图独占 + 会话归属 fail-closed)。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { AiAdminError, AiClientError } from "../ai/errors";
import { generateIllustrations } from "../ai/illustrate-generate";

import { adminThreadDeny, assertAdminThread } from "./admin-thread";

export const generateIllustrationTool = tool(
  async ({ prompt, count }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return adminThreadDeny(config?.configurable?.thread_id, "illustrate");
    try {
      const { images } = await generateIllustrations({ prompt, n: count ?? 1 });
      return JSON.stringify({
        ok: true,
        images: images.map((img, i) => ({
          path: img.path,
          markdown: `![插画${images.length > 1 ? i + 1 : ""}](${img.path})`,
        })),
        hint:
          "把选用的 markdown 原样写入正文对应位置(独占一行,前后空行);多张时择优取用," +
          "未选用的不写入;插画不是信息卡,save_topic_draft 的 card_urls 不含这些图",
      });
    } catch (e) {
      if (e instanceof AiAdminError || e instanceof AiClientError)
        return JSON.stringify({ ok: false, error: e.message });
      throw e;
    }
  },
  {
    name: "generate_illustration",
    description:
      "文生图插画:按小节内容生成概念/场景/氛围插画并存入媒体库(每张约 10-30 秒," +
      "本工具会等待到出图),返回站内路径与 markdown 行。prompt 依本节内容自行撰写" +
      "完整画面描述(主体/场景/风格/构图,与文章主题契合,同篇风格尽量一致);" +
      "不适用于数据密集内容(价格表/对比表/步骤链/榜单——那些走 render_card 信息卡," +
      "文生图渲染精确中文文字不可靠)。返回 ok:false(未绑定模型/生图失败)时该小节" +
      "改走 render_card 即可,不要反复重试。",
    schema: z.object({
      prompt: z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .describe(
          "完整生图提示词:画面主体/场景/风格/构图,中文;避免要求画面内出现精确文字(数字/标签/代码)",
        ),
      count: z
        .number()
        .int()
        .min(1)
        .max(2)
        .optional()
        .describe("生成张数,默认 1;关键小节可 2 张择优(按张计费)"),
    }),
  },
);
