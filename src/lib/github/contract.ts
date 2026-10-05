/**
 * GitHub REST API 响应契约镜像(二期③/M11,真相源 api.github.com):
 * 字段一律 nullable-with-default——单字段脏值降级,不炸整包。
 * commits/releases 列表在 api 层逐条 safeParse(脏行计入 dropped),本文件只出单条 schema。
 */
import { z } from "zod";

/** GET /repos/{owner}/{repo}(仓库改名后 full_name 为 canonical,同步回写) */
export const repoMetaSchema = z.object({
  full_name: z.string().min(1),
  description: z.string().nullish(),
  stargazers_count: z.number().int().nonnegative().catch(0),
  forks_count: z.number().int().nonnegative().catch(0),
  language: z.string().nullish(),
  topics: z.array(z.string()).catch([]),
  html_url: z.string().min(1),
  homepage: z.string().nullish(),
  default_branch: z.string().catch("main"),
  pushed_at: z.string().nullish(),
});
export type RepoMeta = z.output<typeof repoMetaSchema>;

/** GET /repos/{owner}/{repo}/readme(content 为 base64,可含换行) */
export const readmeSchema = z.object({
  content: z.string(),
  sha: z.string().min(1),
  size: z.number().int().nonnegative().catch(0),
});
export type ReadmePayload = z.output<typeof readmeSchema>;

/** GET /repos/{owner}/{repo}/commits 单条 */
export const commitItemSchema = z.object({
  sha: z.string().min(1),
  html_url: z.string().min(1),
  commit: z.object({
    message: z.string().min(1),
    author: z.object({ name: z.string().nullish(), date: z.string().nullish() }).nullish(),
  }),
});
export type CommitItem = z.output<typeof commitItemSchema>;

/** GET /repos/{owner}/{repo}/releases 单条 */
export const releaseItemSchema = z.object({
  id: z.number().int(),
  name: z.string().nullish(),
  tag_name: z.string().min(1),
  html_url: z.string().min(1),
  author: z.object({ login: z.string().nullish() }).nullish(),
  published_at: z.string().nullish(),
  draft: z.boolean().catch(false),
  prerelease: z.boolean().catch(false),
});
export type ReleaseItem = z.output<typeof releaseItemSchema>;
