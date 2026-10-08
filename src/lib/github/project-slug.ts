/**
 * 项目 slug 派生与占位(M11 批②):GitHub 仓库名允许大写/点/下划线,站内 URL 键
 * 统一派生为 [a-z0-9-](lowercase、`.`/`_` → `-`,其余非法字符丢弃,空 → repo 兜底)。
 * slug 登记时派生、此后冻结(GitHub 改名不影响站内 URL,meta 同步只回写 fullName)。
 */
import { prisma } from "../db";

import { GithubAdminError } from "./errors";

/** slug 长度上限(仓库 name ≤100,token 边界截断同 asciiSlugFromTitle 纪律) */
export const MAX_PROJECT_SLUG = 80;

/** 仓库名 → slug 基形(纯函数;`.`/`_` 视作分隔符,连续段去重由 token join 自然合并) */
export function projectSlugFromName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[._]/g, "-")
    .match(/[a-z0-9]+/g);
  const joined = (tokens ?? []).join("-");
  return (joined || "repo").slice(0, MAX_PROJECT_SLUG);
}

/** 基形冲突时的候选后缀:-2…-9(镜像 asciiSlugCandidates) */
function slugCandidates(base: string): string[] {
  return [base, ...Array.from({ length: 8 }, (_, i) => `${base}-${i + 2}`)];
}

/**
 * 登记时选定唯一 slug:预查占用取首个空闲候选(并发窗口由 create 的 P2002 兜底)。
 * 候选全撞 → invalid(admin 清理台账后重试,极小概率事件)。
 */
export async function ensureUniqueProjectSlug(name: string): Promise<string> {
  const candidates = slugCandidates(projectSlugFromName(name));
  const rows = await prisma.githubRepo.findMany({
    where: { slug: { in: candidates } },
    select: { slug: true },
  });
  const taken = new Set(rows.map((r) => r.slug));
  const free = candidates.find((c) => !taken.has(c));
  if (!free) {
    throw new GithubAdminError("invalid", "slug 候选全部占用,请先清理同名仓库台账后重试");
  }
  return free;
}
