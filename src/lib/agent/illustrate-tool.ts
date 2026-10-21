/**
 * 文生图图文·admin 工具(M39 批④建,§13.9 重定义:插画→内容可视化图文):
 * agent 先按内容编排呈现形态(开放集合,指南承载编排原则),再拟 prompt 生图
 * → uploadMedia 入库,回传站内路径与 markdown 行。不交互不挂起(免确认口径同
 * cover auto 档):图文按张计费低成本,管理员在成稿评审时统一定夺去留。工具
 * 只承载机制:宽高比(aspect)是模型物理约束;编排策略/形态选择住 L2 指南,
 * 改形态规则不发版。跨形态硬纪律由工具描述双层承载(§13.7:弱模型渐进披露
 * 不足):文字给原文短句化、字少而大、错字一图至多重出一次;数据密集内容
 * (价格表/对比/榜单)仍走 render_card。未绑定/生图失败人话短句返回,模型改
 * 走 render_card 不阻塞其余小节。纵深防御同 card-tools(admin 图独占 + 会话
 * 归属 fail-closed)。
 * M39 批③:reference_path 样例参照图(brief.sample_image 带出;机制参数不占
 * 指南——使用指引住工具描述 + brief note 双层)。白名单站内媒体前缀,外链拒;
 * 参照装载失败不阻塞生图(执行核心降级),人话原因回带 agent。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { AiAdminError, AiClientError } from "../ai/errors";
import {
  generateIllustrations,
  ILLUSTRATE_ASPECT_SIZES,
  ILLUSTRATE_MAX_COUNT,
} from "../ai/illustrate-generate";

import { adminThreadDeny, assertAdminThread } from "./admin-thread";

const ASPECT_KEYS = Object.keys(ILLUSTRATE_ASPECT_SIZES) as [string, ...string[]];

/** 参照图路径白名单(站内媒体前缀;执行核心 uploadsUrlToRel 二次校验穿越) */
export const REFERENCE_PATH_PREFIX = "/wp-content/uploads/";

export const generateIllustrationTool = tool(
  async ({ prompt, aspect, count, reference_path }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return adminThreadDeny(config?.configurable?.thread_id, "illustrate");
    try {
      const { images, referenceError } = await generateIllustrations({
        prompt,
        aspect,
        n: count ?? 1,
        referencePath: reference_path,
      });
      return JSON.stringify({
        ok: true,
        images: images.map((img, i) => ({
          path: img.path,
          markdown: `![图文${images.length > 1 ? i + 1 : ""}](${img.path})`,
        })),
        ...(referenceError ? { reference_warning: referenceError } : {}),
        hint:
          "把选用的 markdown 原样写入正文对应位置(独占一行,前后空行);多张时择优取用," +
          "未选用的不写入;图文不是信息卡,save_topic_draft 的 card_urls 不含这些图" +
          (referenceError ? ";本次参照图未生效(原因见 reference_warning),已按 prompt 出图" : ""),
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
      "文生图图文:把你编排的呈现形态生成为带字内容图并存入媒体库(每张约 10-60 秒," +
      "本工具会等待到出图),返回站内路径与 markdown 行。先用内容编排:确定这张图" +
      "传达什么信息、用什么形态呈现(要点归纳/金句/头图/对比图解/流程步骤/清单/" +
      "时间线/概念场景带标注等,由内容特点定,形态不设限),再把形态版式、入图" +
      "文字(原文短句化、字少而大)、风格锚定句写进 prompt;横版头图用 16:9," +
      "竖版卡片用 3:4。入图文字是模型画的,错字无法自查:文字宁少勿多,一图至多" +
      "重出一次。数据密集内容(价格表/对比表/榜单)不走本工具,改 render_card" +
      " 信息卡。brief 带 sample_image(样例参照图)时必须把它 media_path 传给" +
      " reference_path,模型以图为风格参照,此时 prompt 的风格锚定句写「保持与参" +
      "考图一致的视觉风格」即可;返回 ok:false(未绑定模型/生图失败)时该处改走" +
      " render_card 即可,不要反复重试。",
    schema: z.object({
      prompt: z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .describe(
          "完整生图提示词(中文):呈现形态与版式布局 + 入图文字逐句给出(标题/要点的原文短句,别改写)" +
            "+ 风格锚定描述(同篇多图重复同一句风格描述保持一致;带 reference_path 时锚定句写" +
            "「保持与参考图一致的视觉风格」);文字宁少勿多,数字直接写明",
        ),
      aspect: z
        .enum(ASPECT_KEYS)
        .optional()
        .describe("宽高比:16:9 横版(头图/章节图,缺省)/ 3:4 竖版(小红书风卡片)/ 1:1 方图"),
      count: z
        .number()
        .int()
        .min(1)
        .max(ILLUSTRATE_MAX_COUNT)
        .optional()
        .describe("生成张数,默认 1;关键图至多 3 张择优(按张计费)"),
      reference_path: z
        .string()
        .trim()
        .max(500)
        .optional()
        .describe(
          "样例参照图的站内媒体路径(brief.sample_image.media_path;仅收 /wp-content/uploads/ " +
            "站内路径,外链无效):传入后出图向参照图的风格靠拢",
        ),
    }),
  },
);
