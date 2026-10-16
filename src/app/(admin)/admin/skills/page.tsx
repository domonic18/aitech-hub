/**
 * 写作技能页(2026-10-16 验收反馈问题二:自「模型配置」第 4 页签提升为独立
 * 页 + 侧栏入口——技能正文可读性是第一诉求,埋在页签里等于不可见)。
 * 台账 = agent_skill 表,agent 侧经 list_skills/get_skill 渐进披露取用,
 * 建改即时生效零发版。
 */
import SkillDialog from "@/components/admin/models/SkillDialog";
import SkillTable from "@/components/admin/models/SkillTable";
import { listSkillsAdmin } from "@/lib/ai/agent-skills-admin";
import { requireAdminPage } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function AdminSkillsPage(): Promise<React.ReactElement> {
  await requireAdminPage();
  const skills = await listSkillsAdmin();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">写作技能</h2>
        <p className="mt-0.5 text-xs text-text-3">
          流程纪律沉淀为可管理资产:编辑器 AI 写作前经技能清单对号取用指南全文,建改即时生效;
          专题可在「专题管理」绑定 skill_key 指定写作技能。
        </p>
      </div>
      <div className="flex justify-end">
        <SkillDialog label="+ 新增技能" />
      </div>
      <SkillTable skills={skills} />
    </div>
  );
}
