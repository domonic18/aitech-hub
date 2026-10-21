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

/** 参照风格冲突检测(纯函数,单测锚点):带参照图时 prompt 出现 HEX 色值即判
 * 自编配色与参照冲突。2026-10-21 验收实证:文字风格指令会压过参照图(Seedream
 * 听文字的),编排模型无视工具描述里的锚定句纪律 → 升级执行侧守卫(fail-closed
 * 人话反馈,模型可自纠重调)。只拦确定性信号 HEX;色名/深浅底类软冲突由系统
 * 提示 + schema 描述双层文本约束承载 */
export function detectReferenceStyleConflict(prompt: string): string | null {
  const hit = prompt.match(/#[0-9a-fA-F]{3,8}\b/);
  return hit ? `prompt 含具体色值 ${hit[0]}` : null;
}

export const generateIllustrationTool = tool(
  async ({ prompt, aspect, count, reference_path }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return adminThreadDeny(config?.configurable?.thread_id, "illustrate");
    // 参照风格冲突守卫:带参照图时 prompt 自编 HEX 配色 → 未出图先拒(不产生
    // 生图费用),人话反馈让模型去掉风格词重调;无参照时不拦(自编配色是常态)
    if (reference_path) {
      const conflict = detectReferenceStyleConflict(prompt);
      if (conflict)
        return JSON.stringify({
          ok: false,
          error:
            `${conflict}。带样例参照图时视觉风格由参照图承载,严禁在 prompt 自编配色` +
            "(HEX 色值/深浅底/衬线等风格词都不要写——文字会压过参照图):请去掉全部风格词," +
            "只保留内容与版式编排,风格锚定句固定写「保持与参考图一致的视觉风格」后重调" +
            "(本次未出图不计费)",
        });
    }
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
        ...(referenceError
          ? { reference_warning: referenceError }
          : reference_path
            ? { reference_applied: true }
            : {}),
        hint:
          "把选用的 markdown 原样写入正文对应位置(独占一行,前后空行);多张时择优取用," +
          "未选用的不写入;图文不是信息卡,save_topic_draft 的 card_urls 不含这些图" +
          (referenceError
            ? ";本次参照图未生效(原因见 reference_warning),已按 prompt 出图"
            : reference_path
              ? ";参照图已生效:同篇后续图文的风格以参照图为准,prompt 仍不要写自编配色"
              : ""),
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
      "本工具会等待到出图),返回站内路径与 markdown 行。先做内容规划,标准是" +
      "「一图看懂全文,且不虎头蛇尾」:第 1 张把全文主干(核心概念/步骤链/关键数据/" +
      "结论)浓缩成全景图,信息全面且精炼;需多张时至多 3 张,按文章结构顺序各完整" +
      "承接一个后半段章节,每张自身信息完整(标题/要点/落点齐全,不是零碎补丁图)," +
      "图片合起来覆盖素材核心笔记的全部主干。不做与正文重复的单点装饰图。再确定这张" +
      "图的形态(全景概览/要点" +
      "归纳/流程步骤/对比图解/时间线/清单等,形态不设限),然后把形态版式、入图" +
      "文字(原文短句化、字少而大)、风格锚定句写进 prompt;横版头图用 16:9," +
      "竖版卡片用 3:4。入图文字是模型画的,错字无法自查:文字宁少勿多,一图至多" +
      "重出一次。数据密集内容(价格表/对比表/榜单)不走本工具,改 render_card" +
      " 信息卡。brief 带 sample_image(样例参照图)时必须把它 media_path 传给" +
      " reference_path,模型以图为风格参照;此时 prompt 严禁写任何具体配色/字体/" +
      "风格词(文字会压过参照图,HEX 色值会被守卫直接拒绝),风格锚定句固定写「保" +
      "持与参考图一致的视觉风格」;返回 ok:false(未绑定模型/风格冲突/生图失败)" +
      "时按报错修正或改走 render_card,不要反复重试。",
    schema: z.object({
      prompt: z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .describe(
          "完整生图提示词(中文):呈现形态与版式布局 + 入图文字逐句给出(标题/要点的原文短句,别改写)" +
            "+ 风格锚定描述(同篇多图重复同一句风格描述保持一致;带 reference_path 时严禁出现" +
            "色值/配色/字体等风格词,锚定句固定写「保持与参考图一致的视觉风格」);" +
            "文字宁少勿多,数字直接写明",
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
            "站内路径,外链无效):传入后视觉风格完全以参照图为准,prompt 不得自编配色" +
            "(HEX 色值会被守卫拒绝)",
        ),
    }),
  },
);
