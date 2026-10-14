/**
 * Agent skill 管理(M30 批①,arch/04):业务流程纪律(写作指南、分发流程等
 * 知识型扩展)落 agent_skill 表——后台建改即时生效零发版;agent 侧经统一两
 * 工具渐进披露取用(批② 接线:listEnabledSkillMetas 元数据先行,
 * getEnabledSkillByKey 按需取全文,机械执行归既有工具/管线)。
 * key 为稳定引用名(topic.skillKey、agent 侧选配),建后不可改;删除为物理删,
 * 软引用随删降级(取不到 = 无 skill,调用侧自行回落),不做 bound 拦截。
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { logger } from "../logger";
import { AiAdminError } from "./errors";

/** 行视图(RSC 页与 GET /api/agent-skills 共用;id 转 number 保 JSON 可序列化) */
export interface AgentSkillRow {
  id: number;
  key: string;
  name: string;
  scenario: string;
  guideMd: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** agent 工具元数据视图(渐进披露第一层;不含 guideMd 正文) */
export interface AgentSkillMeta {
  key: string;
  name: string;
  scenario: string;
}

const ROW_SELECT = {
  id: true,
  key: true,
  name: true,
  scenario: true,
  guideMd: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AgentSkillSelect;

type SkillRecord = Prisma.AgentSkillGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(r: SkillRecord): AgentSkillRow {
  return {
    id: Number(r.id),
    key: r.key,
    name: r.name,
    scenario: r.scenario,
    guideMd: r.guideMd,
    enabled: r.enabled,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** key 约定:小写字母/数字/连字符,字母或数字开头结尾(agent 引用/日志安全) */
export const AGENT_SKILL_KEY_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export const AgentSkillCreateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2, "key 至少 2 字符")
    .max(50)
    .regex(AGENT_SKILL_KEY_RE, "key 仅限小写字母/数字/连字符,开头结尾须为字母或数字"),
  name: z.string().trim().min(1, "名称必填").max(100),
  scenario: z.string().trim().min(1, "适用场景必填").max(200),
  guideMd: z.string().trim().min(1, "指南正文必填").max(50000),
  enabled: z.boolean().optional(),
});
export type AgentSkillInput = z.infer<typeof AgentSkillCreateSchema>;

/** 更新:key 建后不可改(稳定引用),其余全量提交 */
export const AgentSkillUpdateSchema = AgentSkillCreateSchema.omit({ key: true });
export type AgentSkillUpdateInput = z.infer<typeof AgentSkillUpdateSchema>;

/** 技能台账(按 key 展示) */
export async function listSkillsAdmin(): Promise<AgentSkillRow[]> {
  const rows = await prisma.agentSkill.findMany({
    orderBy: { key: "asc" },
    select: ROW_SELECT,
  });
  return rows.map(toRow);
}

/** 新增;key 唯一,重复报 duplicate(409) */
export async function createAgentSkill(input: AgentSkillInput): Promise<{ id: number }> {
  const dup = await prisma.agentSkill.findUnique({
    where: { key: input.key },
    select: { id: true },
  });
  if (dup) throw new AiAdminError("duplicate", `key「${input.key}」已存在`);
  const created = await prisma.agentSkill.create({
    data: {
      key: input.key,
      name: input.name,
      scenario: input.scenario,
      guideMd: input.guideMd,
      enabled: input.enabled ?? true,
    },
    select: { id: true },
  });
  logger.info({ event: "agent_skill.created", key: input.key, skillId: created.id });
  return { id: Number(created.id) };
}

/** 更新(key 不可改);不存在报 not_found(404) */
export async function updateAgentSkill(
  id: number,
  input: AgentSkillUpdateInput,
): Promise<{ id: number }> {
  const existing = await prisma.agentSkill.findUnique({ where: { id }, select: { key: true } });
  if (!existing) throw new AiAdminError("not_found", "技能不存在");
  const updated = await prisma.agentSkill.update({
    where: { id },
    data: {
      name: input.name,
      scenario: input.scenario,
      guideMd: input.guideMd,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    },
    select: { id: true },
  });
  logger.info({ event: "agent_skill.updated", key: existing.key, skillId: updated.id });
  return { id: Number(updated.id) };
}

/** 启停(停用后 agent 侧列表/取用立即不可见,即时生效) */
export async function setAgentSkillEnabled(id: number, enabled: boolean): Promise<void> {
  const r = await prisma.agentSkill.updateMany({ where: { id }, data: { enabled } });
  if (r.count === 0) throw new AiAdminError("not_found", "技能不存在");
  logger.info({ event: enabled ? "agent_skill.enabled" : "agent_skill.disabled", skillId: id });
}

/** 物理删(topic.skillKey 为软引用,随删降级,不做 bound 拦截) */
export async function deleteAgentSkill(id: number): Promise<void> {
  const r = await prisma.agentSkill.deleteMany({ where: { id } });
  if (r.count === 0) throw new AiAdminError("not_found", "技能不存在");
  logger.info({ event: "agent_skill.deleted", skillId: id });
}

// ── agent 侧取数口(批② 工具接线;与后台 CRUD 同库同真相) ─────────────

/** 元数据清单(渐进披露第一层;仅启用项,按 key 稳定排序) */
export async function listEnabledSkillMetas(): Promise<AgentSkillMeta[]> {
  const rows = await prisma.agentSkill.findMany({
    where: { enabled: true },
    orderBy: { key: "asc" },
    select: { key: true, name: true, scenario: true },
  });
  return rows;
}

/** 按 key 取全文(渐进披露第二层;仅启用项,停用/缺失返回 null) */
export async function getEnabledSkillByKey(
  key: string,
): Promise<(AgentSkillMeta & { guideMd: string }) | null> {
  const row = await prisma.agentSkill.findUnique({
    where: { key },
    select: { key: true, name: true, scenario: true, guideMd: true, enabled: true },
  });
  if (!row || !row.enabled) return null;
  return { key: row.key, name: row.name, scenario: row.scenario, guideMd: row.guideMd };
}
