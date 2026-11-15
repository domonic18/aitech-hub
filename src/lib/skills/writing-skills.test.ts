/**
 * 写作指南读取单测(M72 B1):直接读仓库真实文件(不 mock fs)——
 * 守卫单测 writing-skills-files.test 守的是「文件内容对不对」,
 * 这里守的是「读取层的边界对不对」(路径穿越/缺文件/元数据完整)。
 */
import { describe, expect, it } from "vitest";

import { listWritingSkills, readWritingSkill } from "./writing-skills";

describe("写作指南读取", () => {
  it("列出全部指南,元数据齐全(key/name/scenario/version/正文长度)", () => {
    const skills = listWritingSkills();
    expect(skills.length).toBeGreaterThanOrEqual(7);
    for (const s of skills) {
      expect(s.key, "缺 key").toBeTruthy();
      expect(s.name, `${s.key} 缺 name`).toBeTruthy();
      expect(s.scenario, `${s.key} 缺 scenario`).toBeTruthy();
      expect(s.version, `${s.key} 缺 version`).toBeTruthy();
      expect(s.length, `${s.key} 正文为空`).toBeGreaterThan(500);
    }
  });

  it("取单份指南:frontmatter 拆出、正文原样(不含 frontmatter 残留)", () => {
    const skill = readWritingSkill("blogger-video");
    expect(skill).not.toBeNull();
    expect(skill!.key).toBe("blogger-video");
    expect(skill!.guideMd.length).toBeGreaterThan(500);
    expect(skill!.guideMd.startsWith("---")).toBe(false);
    expect(skill!.guideMd).not.toContain("exported_from:");
  });

  it("路径穿越的 key 一律拒(取不到就是取不到)", () => {
    for (const bad of ["../package", "../../etc/passwd", "a/b", "UPPER", ""]) {
      expect(readWritingSkill(bad), `key=${bad} 不该读到`).toBeNull();
    }
  });

  it("不存在的 key → null(不抛)", () => {
    expect(readWritingSkill("no-such-skill")).toBeNull();
  });
});
