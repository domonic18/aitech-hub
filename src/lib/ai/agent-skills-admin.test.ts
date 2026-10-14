/**
 * Agent skill 管理单测(M30 批①):key 规则与 zod schema(更新侧 key 不可改)
 * + CRUD/agent 取数口分支(duplicate/not_found/停用不可见/id 转 number)。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    agentSkill: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "../db";
import { AiAdminError } from "./errors";
import {
  AgentSkillCreateSchema,
  AgentSkillUpdateSchema,
  createAgentSkill,
  deleteAgentSkill,
  getEnabledSkillByKey,
  listEnabledSkillMetas,
  listSkillsAdmin,
  setAgentSkillEnabled,
  updateAgentSkill,
} from "./agent-skills-admin";

const findUnique = vi.mocked(prisma.agentSkill.findUnique);
const findMany = vi.mocked(prisma.agentSkill.findMany);
const create = vi.mocked(prisma.agentSkill.create);
const update = vi.mocked(prisma.agentSkill.update);
const updateMany = vi.mocked(prisma.agentSkill.updateMany);
const deleteMany = vi.mocked(prisma.agentSkill.deleteMany);

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
    expect.unreachable("should throw");
  } catch (e) {
    expect(e).toBeInstanceOf(AiAdminError);
    expect((e as AiAdminError).code).toBe(code);
  }
}

describe("AgentSkillCreateSchema(key 规则)", () => {
  it("合法 key:小写字母/数字/连字符,开头结尾字母或数字", () => {
    expect(AgentSkillCreateSchema.safeParse(VALID).success).toBe(true);
    expect(AgentSkillCreateSchema.safeParse({ ...VALID, key: "a1" }).success).toBe(true);
    expect(AgentSkillCreateSchema.safeParse({ ...VALID, key: `${"a".repeat(49)}0` }).success).toBe(
      true,
    );
  });

  it("非法 key:大写/首尾连字符/单字符/超长/空格", () => {
    for (const key of ["Blogger", "-lead", "trail-", "a", `${"a".repeat(50)}0`, "a b", "中文key"]) {
      expect(AgentSkillCreateSchema.safeParse({ ...VALID, key }).success).toBe(false);
    }
  });

  it("name/scenario/guideMd 必填;enabled 选填", () => {
    expect(AgentSkillCreateSchema.safeParse({ ...VALID, name: "" }).success).toBe(false);
    expect(AgentSkillCreateSchema.safeParse({ ...VALID, scenario: "" }).success).toBe(false);
    expect(AgentSkillCreateSchema.safeParse({ ...VALID, guideMd: "" }).success).toBe(false);
    expect(AgentSkillCreateSchema.safeParse({ ...VALID, enabled: undefined }).success).toBe(true);
  });

  it("更新侧 omit key:多传 key 被剥离(建后不可改)", () => {
    const r = AgentSkillUpdateSchema.parse({ name: "n", scenario: "s", guideMd: "g", key: "x" });
    expect("key" in r).toBe(false);
  });
});

describe("CRUD 与 agent 取数口", () => {
  it("create:key 重复 → duplicate;成功默认启用并转 number id", async () => {
    findUnique.mockResolvedValueOnce({ id: BigInt(1) } as never);
    await expectCode(createAgentSkill(VALID), "duplicate");

    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: BigInt(5) } as never);
    await expect(createAgentSkill(VALID)).resolves.toEqual({ id: 5 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enabled: true }) }),
    );
  });

  it("update:不存在 → not_found;成功不回写 key", async () => {
    findUnique.mockResolvedValueOnce(null);
    await expectCode(updateAgentSkill(1, { name: "n", scenario: "s", guideMd: "g" }), "not_found");

    findUnique.mockResolvedValueOnce({ key: "k" } as never);
    update.mockResolvedValueOnce({ id: BigInt(7) } as never);
    await expect(
      updateAgentSkill(1, { name: "n", scenario: "s", guideMd: "g", enabled: false }),
    ).resolves.toEqual({ id: 7 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "n", scenario: "s", guideMd: "g", enabled: false } }),
    );
  });

  it("启停/删除:count=0 → not_found", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expectCode(setAgentSkillEnabled(9, false), "not_found");
    deleteMany.mockResolvedValueOnce({ count: 0 });
    await expectCode(deleteAgentSkill(9), "not_found");
    updateMany.mockResolvedValueOnce({ count: 1 });
    deleteMany.mockResolvedValueOnce({ count: 1 });
    await expect(setAgentSkillEnabled(9, true)).resolves.toBeUndefined();
    await expect(deleteAgentSkill(9)).resolves.toBeUndefined();
  });

  it("listSkillsAdmin:BigInt id 转 number;listEnabledSkillMetas 仅启用项", async () => {
    findMany.mockResolvedValueOnce([ROW] as never);
    await expect(listSkillsAdmin()).resolves.toEqual([{ ...ROW, id: 3 }]);

    findMany.mockResolvedValueOnce([{ key: "k", name: "n", scenario: "s" }] as never);
    await expect(listEnabledSkillMetas()).resolves.toHaveLength(1);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    );
  });

  it("getEnabledSkillByKey:缺失/停用 → null;启用含全文", async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(getEnabledSkillByKey("k")).resolves.toBeNull();
    findUnique.mockResolvedValueOnce({
      key: "k",
      name: "n",
      scenario: "s",
      guideMd: "g",
      enabled: false,
    } as never);
    await expect(getEnabledSkillByKey("k")).resolves.toBeNull();
    findUnique.mockResolvedValueOnce({
      key: "k",
      name: "n",
      scenario: "s",
      guideMd: "g",
      enabled: true,
    } as never);
    await expect(getEnabledSkillByKey("k")).resolves.toEqual({
      key: "k",
      name: "n",
      scenario: "s",
      guideMd: "g",
    });
  });
});

const VALID = {
  key: "blogger-video",
  name: "博主×视频推荐短文",
  scenario: "公众号「博主×视频」推荐短文",
  guideMd: "# 指南",
};

const ROW = {
  id: BigInt(3),
  key: "blogger-video",
  name: "博主×视频推荐短文",
  scenario: "公众号「博主×视频」推荐短文",
  guideMd: "# 指南",
  enabled: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};
