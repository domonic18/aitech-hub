"use client";

/**
 * 初稿生成动作区(2026-10-20 详情页重构,替代 TopicComposeActions)——详情页
 * 第④区动作件:生成初稿/重新生成初稿经唤起协议注入任务到全局宿主卡(根
 * layout 常驻,跨页存活)。与旧件的关键差异:
 * - 撰写目的下拉删除——内容形式改由第②区写作要求单点配置,体裁词由服务端
 *   resolvePurpose 从落库文本派生后传入(治 post-319 双真相源漂移的根);
 * - 「补充要求」降级为仅本次可选输入(不落库,拼进任务话术);
 * - 文案去「合成」术语(生成初稿/重新生成初稿)。
 * agent 自主编排:write_todos 列计划 → 读素材/选题/写作/配图/落库,完成后在
 * 对话汇报并给文档链接;落库走 save_topic_draft 工具。空素材按钮侧就地拦截
 * (零真网防线,e2e 34 断言同文);覆盖确认由工具 needConfirm → agent ask_user
 * 回路承接。历史教训:M31 验收实证本类组件曾自持内嵌 AssistantCard,切页即
 * 卸载杀 run——页面禁止自持卡,接入一律走 agent-host 协议。
 */
import { useState } from "react";

import { openAgentAssistant } from "@/lib/agent/agent-host";

/** 封面免确认档位锚点(2026-10-20 验收反馈问题二):任务话术尾部固定追加,
 * 把「专题合成走封面自动档」写进任务指令本身,不依赖模型记忆任务来源 */
const COVER_AUTO_HINT = "。头图直接自动生成并采用(自动档),不要用 ask_user 向我确认封面方向或提示词";

export default function TopicDraftActions({
  topicId,
  topicTitle,
  materialsCount,
  hasDoc,
  linkedPostStatus,
  editedSinceCompose,
  genreWord,
}: {
  topicId: string;
  topicTitle: string;
  /** 已添加素材数(0 = 按钮侧就地拦截,不发任务) */
  materialsCount: number;
  hasDoc: boolean;
  /** 关联文档状态(重生成提示口径:published 覆盖即线上内容变更) */
  linkedPostStatus: string | null;
  /** 服务端预判:初稿生成后被人工编辑过(按钮 title 提示,实际判定以工具 needConfirm 为准) */
  editedSinceCompose: boolean;
  /** 体裁词(服务端 resolvePurpose 由写作要求派生:视频安利稿/含文字版教程/自定义回落) */
  genreWord: string;
}) {
  const [extra, setExtra] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  /** 经唤起协议注入生成任务;话术带体裁词与仅本次补充要求(空则省略)与封面
   * 免确认锚点;素材空就地拦截(与工具层预检同文人话) */
  function compose(): void {
    if (materialsCount === 0) {
      setMsg({ tone: "err", text: "还没有素材——先添加 2~3 条解读/文章,再来生成初稿" });
      return;
    }
    setMsg(null);
    const extraPart = extra.trim() ? `,补充要求:${extra.trim()}` : "";
    openAgentAssistant({
      question: hasDoc
        ? `请为专题《${topicTitle}》(专题 id:${topicId})重新生成初稿【${genreWord}】,将覆盖现有文档${extraPart}${COVER_AUTO_HINT}`
        : `请为专题《${topicTitle}》(专题 id:${topicId})生成初稿【${genreWord}】${extraPart}${COVER_AUTO_HINT}`,
      send: true,
    });
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={compose}
          className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90"
          title={
            editedSinceCompose
              ? linkedPostStatus === "published"
                ? "文档已发布且初稿后被编辑过,重新生成将覆盖线上内容"
                : "文档在初稿生成后被人工编辑过,重新生成将确认后覆盖"
              : undefined
          }
        >
          {hasDoc ? "重新生成初稿" : "生成初稿"}
        </button>
        <input
          value={extra}
          maxLength={200}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="补充要求(仅本次,如:重点展开需求清单那一节)"
          className="min-w-64 flex-1 rounded-sm border border-line bg-panel px-2 py-1 text-[12px] outline-none focus:border-accent placeholder:text-text-3"
          aria-label="本次补充要求"
        />
      </div>
      <span className="text-[11px] text-text-3">
        在右侧 AI 对话框执行:agent 自主编排(读素材→选题→写作→配图→落库);写作要求按上方配置生效
      </span>
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
