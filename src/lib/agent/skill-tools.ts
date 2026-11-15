/**
 * Agent skill 渐进披露·admin 工具面(M30 批②):list_skills 元数据先行
 * (key/名称/适用场景,零正文开销知全貌)→ get_skill 按需取指南全文——
 * 两段式取用,系统提示只载调度条款不载指南正文,skill 增删改零改提示词。
 * 指南来源(M72 B7):`agent_skill` 表退役,改读站内版指南常量
 * (`ai/skill-registry.ts`);线下另有仓库 md 一份给 MCP/线下助手(同源不同语境)。
 * 纵深防御同 topic-tools:
 * admin 图独占 + 工具体内验会话归属(fail-closed)。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { getEnabledSkillByKey, listEnabledSkillMetas } from "../ai/skill-registry";

import { adminThreadDeny, assertAdminThread } from "./admin-thread";

const denyPayload = (threadId: unknown): string => adminThreadDeny(threadId, "skill");

export const listSkillsTool = tool(
  async (_args, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    const skills = await listEnabledSkillMetas();
    return JSON.stringify({
      skills,
      note:
        "写专题文章前必看:按 scenario 匹配本次任务的技能,命中即用 get_skill 取指南全文;" +
        "专题 brief 的 topic.skill_key 已指定时跳过匹配直接取该 key",
    });
  },
  {
    name: "list_skills",
    description:
      "查看全部可用技能清单(key/名称/适用场景,不含正文)。写作/成文类任务开始前必调:" +
      "按适用场景对号入座,命中的技能再用 get_skill 取全文;清单为空或无命中时按素材" +
      "常识写作。技能由管理员在后台维护,即时生效。",
    schema: z.object({}),
  },
);

export const getSkillTool = tool(
  async ({ key }, config) => {
    if (!(await assertAdminThread(config?.configurable?.thread_id)))
      return denyPayload(config?.configurable?.thread_id);
    const skill = await getEnabledSkillByKey(key);
    if (!skill) {
      return JSON.stringify({ ok: false, error: `技能「${key}」不存在或已停用` });
    }
    return JSON.stringify({
      ok: true,
      key: skill.key,
      name: skill.name,
      scenario: skill.scenario,
      guide_md: skill.guideMd,
      note: "起草严格按指南全文执行(结构/口吻/字数/配图/码点预算均以指南为准)",
    });
  },
  {
    name: "get_skill",
    description:
      "按 key 取技能指南全文(写作纪律/流程要求/预算约束)。list_skills 命中或专题" +
      "topic.skill_key 指定后必调,取到指南后严格按其执行;写作中途不再重复调用。",
    schema: z.object({
      key: z
        .string()
        .trim()
        .min(1)
        .max(50)
        .describe("技能 key(list_skills 返回或专题绑定的 skill_key)"),
    }),
  },
);

export const SKILL_TOOLS = [listSkillsTool, getSkillTool];
