/**
 * resolveUpsertAction 四分支单测(DB 流程由 e2e 用例 10 覆盖):
 * 不存在→create / 有 md→update / 软删占 slug→409 / HTML 旧文→409 不绕过。
 */
import { describe, expect, it, vi } from "vitest";

// publish-api 经 logger/media/service 传递 import env(导入期校验 + storage 模块级
// new LocalDiskProvider(env.MEDIA_DIR));CI 无 .env,按仓库惯例 mock 掉
vi.mock("@/lib/env", () => ({
  env: {
    AUTH_SECRET: "test-secret-0123456789-abcdef",
    MEDIA_DIR: "/tmp/aitech-ci-media",
  },
}));

import { resolveUpsertAction } from "./publish-api";
import { PostAdminError } from "./posts-admin";

const EXISTING_MD = { id: BigInt(2), status: "published", contentMd: "# 正文" };
const EXISTING_HTML = { id: BigInt(3), status: "published", contentMd: null };
const EXISTING_DELETED = { id: BigInt(4), status: "deleted", contentMd: "# x" };

describe("resolveUpsertAction(slug 幂等裁定)", () => {
  it("不存在 → create", () => {
    expect(resolveUpsertAction(null)).toEqual({ action: "create" });
  });

  it("存在且有 contentMd → update(携带 id)", () => {
    expect(resolveUpsertAction(EXISTING_MD)).toEqual({ action: "update", id: EXISTING_MD.id });
  });

  it("slug 被软删占用 → slug_conflict 409", () => {
    try {
      resolveUpsertAction(EXISTING_DELETED);
      expect.unreachable("应抛出");
    } catch (e) {
      expect(e).toBeInstanceOf(PostAdminError);
      expect((e as PostAdminError).code).toBe("slug_conflict");
    }
  });

  it("残留 HTML 旧文 → legacy_readonly 409,不绕过(旧文保真红线跨通道一致)", () => {
    try {
      resolveUpsertAction(EXISTING_HTML);
      expect.unreachable("应抛出");
    } catch (e) {
      expect(e).toBeInstanceOf(PostAdminError);
      expect((e as PostAdminError).code).toBe("legacy_readonly");
    }
  });
});
