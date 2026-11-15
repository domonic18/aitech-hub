/**
 * 站内指南注册表视图(M72 瘦身 B7,2026-11-15):`agent_skill` 表退役后,
 * 站内 agent 侧的渐进披露(list_skills / get_skill)改读**站内版指南常量**
 * (`src/lib/ai/writing-guides.ts`)。
 *
 * 为什么留这一份(而不是直接指向仓库 md):仓库 `skills/writing/*.md` 是**线下
 * 语境**版本(工具指向按线下改写:本地生成图、经 /api/media/ 上传、MCP
 * upsert_article),注入站内 agent 会让模型去调不存在的工具;站内版保留站内
 * 工具名(render_card / save_topic_draft / generate_illustration 等),两套同源
 * 不同语境。站内版随 B4(删 agent 写工具)整体退役,届时站内只剩仓库 md 一份。
 */
import { WRITING_SKILLS } from "./writing-guides";

/** key 约定:小写字母/数字/连字符,字母或数字开头结尾(引用与日志安全) */
export const AGENT_SKILL_KEY_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

/** 渐进披露第一层:元数据(不含正文) */
export interface SkillMeta {
  key: string;
  name: string;
  scenario: string;
}

/** 第二层:指南全文 */
export interface SkillFull extends SkillMeta {
  guideMd: string;
}

/** 全部启用指南的元数据(按 key 升序) */
export function listEnabledSkillMetas(): SkillMeta[] {
  return WRITING_SKILLS.filter((s) => s.enabled).map((s) => ({
    key: s.key,
    name: s.name,
    scenario: s.scenario,
  }));
}

/** 按 key 取指南全文;不存在或停用 → null */
export function getEnabledSkillByKey(key: string): SkillFull | null {
  const s = WRITING_SKILLS.find((x) => x.key === key);
  if (!s || !s.enabled) return null;
  return { key: s.key, name: s.name, scenario: s.scenario, guideMd: s.guideMd };
}
