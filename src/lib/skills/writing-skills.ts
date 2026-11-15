/**
 * 写作指南读取(M72 B1):MCP `list_skills` / `get_skill` 的唯一取数口。
 *
 * 真相源 = 仓库 `skills/writing/*.md`(M72 B2 落地;站内 agent_skill 表与
 * TS 常量随瘦身后续批次退役)。运行时从镜像内副本读(见 Dockerfile 的 COPY 与
 * .dockerignore 的例外)——**镜像内副本可能滞后于本地 checkout**,故 MCP
 * 返回的指南只作兜底,线下 Claude Code 应直接读工作副本里的同名文件。
 *
 * 口径:
 * - 只读 `skills/writing/` 目录,不入库不出网;
 * - key 严校 `/^[a-z0-9-]+$/` 且解析后路径必须仍在目录内(防路径穿越);
 * - frontmatter 解析只认 `key/name/scenario/version` 四字段,其余正文原样;
 * - 读失败(目录不存在/文件缺失)一律返回 null 或空数组,不让工具崩。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** 指南目录(相对进程工作目录;容器内 = /app,开发态 = 仓库根) */
const SKILLS_DIR = path.join(process.cwd(), "skills", "writing");

/** key 合法形态(与站内 AGENT_SKILL_KEY_RE 同域) */
const SKILL_KEY_RE = /^[a-z0-9-]+$/;

/** 单份指南的元数据(不含正文,给 list 用) */
export interface WritingSkillMeta {
  key: string;
  name: string;
  scenario: string;
  version: string;
  /** 正文字数(不含 frontmatter) */
  length: number;
}

/** 单份指南全文 */
export interface WritingSkill extends WritingSkillMeta {
  /** 正文(frontmatter 之后,原文) */
  guideMd: string;
}

/** frontmatter 解析:取首个 --- 块里的 key/value */
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (m === null) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: (m[2] ?? "").trim() };
}

/** 目录内的指南文件名(排除 INDEX.md) */
function skillFiles(): string[] {
  try {
    return readdirSync(SKILLS_DIR)
      .filter((f) => f.endsWith(".md") && f !== "INDEX.md")
      .map((f) => f.replace(/\.md$/, ""))
      .filter((k) => SKILL_KEY_RE.test(k))
      .sort();
  } catch {
    return [];
  }
}

/** 列全部写作指南的元数据(不含正文) */
export function listWritingSkills(): WritingSkillMeta[] {
  const out: WritingSkillMeta[] = [];
  for (const key of skillFiles()) {
    const skill = readWritingSkill(key);
    if (skill === null) continue;
    const { guideMd: _guide, ...meta } = skill;
    out.push(meta);
  }
  return out;
}

/** 取单份指南全文;key 非法或文件缺失 → null */
export function readWritingSkill(key: string): WritingSkill | null {
  if (!SKILL_KEY_RE.test(key)) return null;
  const file = path.join(SKILLS_DIR, `${key}.md`);
  // 双保险:解析后必须仍在目录内(key 已严校,这里是防目录被软链带偏)
  if (path.dirname(path.resolve(file)) !== path.resolve(SKILLS_DIR)) return null;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(text);
  return {
    key: meta.key ?? key,
    name: meta.name ?? key,
    scenario: meta.scenario ?? "",
    version: meta.version ?? "",
    length: body.length,
    guideMd: body,
  };
}
