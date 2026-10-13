/**
 * compose_topic_draft 工具(M27 批④,1276 验收反馈「合成要在侧边栏 agent 里
 * 可视化执行」):admin 会话在对话框内发起专题合成——共享资格预检
 * (checkComposeEligibility)→ 入队 BullMQ 四步管线 → 工具体内轮询至终态,
 * 结果 JSON 回给模型转述。生产核仍跑 worker(可视化的是过程,确定性的是
 * 生产):抽屉关闭/断连只影响对话流,BullMQ job 照常落库。needConfirm 语义:
 * 返回标记后由模型经 ask_user 征得用户确认,带 confirm=true 重调(HITL 回路)。
 * 纵深防御:图侧工具按身份档分发(admin 独占)之外,工具体内再验会话行归属
 * 是 admin(fail-closed)。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { AiAdminError } from "../ai/errors";
import { prisma } from "../db";
import { logger } from "../logger";
import {
  checkComposeEligibility,
  enqueueTopicCompose,
  getTopicComposeState,
} from "../topics/compose-agent";
import { TopicError } from "../topics/repo";

/** 轮询节奏与上限(与专题页按钮轮询同口径:管线约 1~3 分钟,6 分钟兜底) */
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_MS = 6 * 60_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 工具回给模型的 JSON(ok=false 时模型按 error 人话转述,不得编造结果) */
interface ComposeToolPayload {
  ok: boolean;
  error?: string;
  needConfirm?: boolean;
  timeout?: boolean;
  postId?: string;
  postTitle?: string;
  postUrl?: string;
  recomposed?: boolean;
  coverPath?: string | null;
  fallback?: boolean;
}

/** 会话行归属校验(admin: 前缀;无行/他人行一律拒,fail-closed) */
async function assertAdminThread(threadId: unknown): Promise<boolean> {
  if (typeof threadId !== "string" || threadId === "") return false;
  const session = await prisma.searchAgentSession.findUnique({
    where: { id: threadId },
    select: { visitorId: true },
  });
  return session?.visitorId.startsWith("admin:") ?? false;
}

export const composeTopicDraftTool = tool(
  async ({ topic_id, confirm }, config) => {
    const threadId = config?.configurable?.thread_id;
    if (!(await assertAdminThread(threadId))) {
      logger.warn({
        event: "agent.compose_tool_denied",
        threadId: typeof threadId === "string" ? threadId : undefined,
      });
      return JSON.stringify({ ok: false, error: "无权限:仅管理员会话可执行专题合成" });
    }
    try {
      const pre = await checkComposeEligibility(BigInt(topic_id), confirm);
      if (!pre.ok) {
        return JSON.stringify({
          ok: false,
          error: pre.message,
          ...(pre.needConfirm ? { needConfirm: true } : {}),
        });
      }
      await enqueueTopicCompose(BigInt(topic_id));
    } catch (e) {
      // AiAdminError(未绑模型)/TopicError(409 进行中)均为预期业务降级,
      // 人话回给模型;其余原样上抛由 run 层收束
      if (e instanceof AiAdminError || e instanceof TopicError) {
        return JSON.stringify({ ok: false, error: e.message });
      }
      throw e;
    }
    const startedAt = Date.now();
    for (;;) {
      const st = await getTopicComposeState(BigInt(topic_id));
      if (st.state === "done" && st.result) {
        return JSON.stringify({
          ok: true,
          postId: st.result.postId,
          postTitle: st.result.postTitle,
          postUrl: `/admin/posts/${st.result.postId}`,
          recomposed: st.result.recomposed,
          coverPath: st.result.coverPath,
          fallback: st.result.fallback,
        } satisfies ComposeToolPayload);
      }
      if (st.state === "failed") {
        return JSON.stringify({ ok: false, error: st.error ?? "合成失败,请重试" });
      }
      if (Date.now() - startedAt > POLL_MAX_MS) {
        return JSON.stringify({
          ok: false,
          timeout: true,
          error: "合成耗时较长,仍在后台运行;请告知用户稍后到专题页查看结果,不要编造结果",
        });
      }
      await sleep(POLL_INTERVAL_MS);
    }
  },
  {
    name: "compose_topic_draft",
    description:
      "为指定专题执行「博主×视频」推荐文章合成(AI 四步管线:选题角度→起草→自检→" +
      "修订,约 1~3 分钟,本工具会等待到完成)。适用:管理员要求为专题合成/重新合成" +
      "推荐文章初稿。规则:调用前先用 write_todos 列出计划;返回 needConfirm 时必须" +
      "先用 ask_user 征得用户确认,再带 confirm=true 重新调用;完成后向用户汇报文章" +
      "标题、结构与文档链接(postUrl,markdown 链接),封面已自动转存为文章头图;" +
      "返回 error 或 timeout 时如实转述,不要编造结果。",
    schema: z.object({
      topic_id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe("专题 id(专题管理详情页 URL 中的数字 id)"),
      confirm: z
        .boolean()
        .default(false)
        .describe("重合成覆盖确认;仅在本工具返回 needConfirm 且用户经 ask_user 同意后置 true"),
    }),
  },
);
