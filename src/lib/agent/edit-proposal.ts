/**
 * propose_edits 改稿提案契约(M27 批⑧-c,hitl.ts 同款零依赖纪律):编辑助手
 * 「提案不落笔」底座——agent 以 propose_edits 工具发起中断(工具体内裸
 * interrupt,ask_user 同款机制),前端按 interrupt kind 分发评审面,评审结果
 * resume 回灌工具体(正常 ToolMessage,非 error 语义)。S/R 块(Claude Code
 * Edit 语义:oldString 须原文唯一命中)与整档重写双档;工具端零写库,写入
 * 永远 = 人接受 → 编辑器回写 → 既有自动保存 PUT 落库。客户端 bundle 不得经
 * tools.ts 拉入 prisma/deepagents,前后端形状共用本模块。
 */

export const AGENT_PROPOSE_EDITS_TOOL = "propose_edits";

/** S/R 修改块(edits 档;oldString 从现稿逐字符复制,全文唯一命中) */
export interface ProposeEditsEdit {
  oldString: string;
  newString: string;
  /** 本块改动意图(评审面展示) */
  note?: string;
}

/** 提案载荷(interrupt value;edits 档与 rewrite 档二选一,工具端 zod 把关) */
export interface ProposeEditsPayload {
  kind: "propose_edits";
  mode: "edits" | "rewrite";
  /** 提案总体说明(评审面头部展示) */
  note: string;
  /** edits 档:S/R 块列表 */
  edits?: ProposeEditsEdit[];
  /** rewrite 档:整档新文 */
  contentMd?: string;
}

/** 评审结果 resume 值(interrupt() 恢复后原样返回工具体) */
export type ProposeEditsDecision = "applied" | "partial" | "rejected" | "unavailable";

export interface ProposeEditsResume {
  decision: ProposeEditsDecision;
  /** 实际接受的块数(applied/partial 回传,agent 可知多少块生效) */
  applied?: number;
  /** 评审评语(rejected/partial 时 agent 据此迭代) */
  comment?: string;
}

export interface ProposeEditsResumeCommand {
  /** kind 由构造器统一注入(stream 路由 resumeSchema 第二分支判别位;
   * 2026-10-14 验收实证:缺 kind 时 union 两分支全挂 400,前端「回执
   * 发送失败」——评审卡与降级卡同源,构造器单点收口) */
  resume: ProposeEditsResume & { kind: typeof AGENT_PROPOSE_EDITS_TOOL };
}

/**
 * 从 interrupt 状态值解析提案载荷(useLangGraphInterruptState().value →
 * 分发)。kind 不符或形状缺损返 null,由调用方落其他卡/兜底。
 */
export function parseProposeEditsInterrupt(value: unknown): ProposeEditsPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== AGENT_PROPOSE_EDITS_TOOL) return null;
  if (v.mode !== "edits" && v.mode !== "rewrite") return null;
  if (typeof v.note !== "string") return null;
  if (v.mode === "edits") {
    if (!Array.isArray(v.edits) || v.edits.length === 0) return null;
    const edits: ProposeEditsEdit[] = [];
    for (const e of v.edits) {
      if (typeof e !== "object" || e === null) return null;
      const ed = e as Record<string, unknown>;
      if (typeof ed.oldString !== "string" || ed.oldString === "") return null;
      if (typeof ed.newString !== "string") return null;
      edits.push({
        oldString: ed.oldString,
        newString: ed.newString,
        ...(typeof ed.note === "string" && ed.note !== "" ? { note: ed.note } : {}),
      });
    }
    return { kind: AGENT_PROPOSE_EDITS_TOOL, mode: "edits", note: v.note, edits };
  }
  if (typeof v.contentMd !== "string" || v.contentMd === "") return null;
  return { kind: AGENT_PROPOSE_EDITS_TOOL, mode: "rewrite", note: v.note, contentMd: v.contentMd };
}

/** 构造 resume 命令体(runtime sendCommand → POST body.command);kind 注入见上 */
export function buildProposeEditsResumeCommand(
  resume: ProposeEditsResume,
): ProposeEditsResumeCommand {
  return { resume: { ...resume, kind: AGENT_PROPOSE_EDITS_TOOL } };
}
