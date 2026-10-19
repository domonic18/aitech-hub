"use client";

/**
 * 专题合成操作区(M27 批⑤,agent 自主生产重构;M35 宿主唯一化改版;2026-10-18
 * 体裁治理):点「合成初稿/重合成」经唤起协议注入合成任务到全局宿主卡(根
 * layout 常驻,跨页存活)。撰写目的 picker(预置 TOPIC_PURPOSES,缺省取专题
 * 定位匹配)+ 可选补充要求单行框——合成话术带体裁词,治 post-319「话术写死
 * 推荐体裁、教程意图无入口」;agent 自主编排:write_todos 列计划 → 读素材/
 * 选题/写作/配图/落库,完成后在对话汇报并给文档链接;落库走 save_topic_draft
 * 工具(锚定核与 SEO/标签一次交付)。空素材在按钮侧就地拦截(零真网防线,
 * e2e 34 断言同文);重合成的覆盖确认由工具 needConfirm → agent ask_user 回路
 * 承接。历史教训:M31 验收实证本组件曾自持内嵌 AssistantCard,切页即卸载杀
 * run——页面禁止自持卡,接入一律走 agent-host 协议。
 */
import { useState } from "react";
import Link from "next/link";

import { openAgentAssistant } from "@/lib/agent/agent-host";
import { matchTopicPurpose, TOPIC_PURPOSES, type TopicPurposeKey } from "@/lib/topics/constants";

export default function TopicComposeActions({
  topicId,
  topicTitle,
  positioning,
  materialsCount,
  linkedPostId,
  linkedPostStatus,
  editedSinceCompose,
}: {
  topicId: string;
  topicTitle: string;
  /** 专题定位(缺省目的据此匹配:等于预置模板即该目的,自定义/空=视频安利) */
  positioning: string | null;
  /** 挂载素材数(0 = 按钮侧就地拦截,不开抽屉) */
  materialsCount: number;
  linkedPostId: string | null;
  /** 关联文档状态(重合成提示口径:published 覆盖即上线内容变更) */
  linkedPostStatus: string | null;
  /** 服务端预判:合成后被人工编辑过(按钮 title 提示,实际判定以工具 needConfirm 为准) */
  editedSinceCompose: boolean;
}) {
  const [purpose, setPurpose] = useState<TopicPurposeKey>(
    () => matchTopicPurpose(positioning) ?? "video-recommend",
  );
  const [extra, setExtra] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  /** 经唤起协议注入合成任务;话术带体裁词与补充要求(空则省略);
   * 素材空就地拦截(与工具层预检同文人话) */
  function compose(): void {
    if (materialsCount === 0) {
      setMsg({ tone: "err", text: "尚未挂载素材——先挂 2~3 条解读/文章再合成" });
      return;
    }
    setMsg(null);
    const genre = TOPIC_PURPOSES.find((t) => t.key === purpose)?.genreWord ?? "视频安利稿";
    const extraPart = extra.trim() ? `,补充要求:${extra.trim()}` : "";
    openAgentAssistant({
      question: linkedPostId
        ? `请为专题《${topicTitle}》(专题 id:${topicId})重新合成【${genre}】,将覆盖关联文档${extraPart}`
        : `请为专题《${topicTitle}》(专题 id:${topicId})合成【${genre}】初稿${extraPart}`,
      send: true,
    });
  }

  const hasDoc = linkedPostId !== null;

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
                ? "关联文档已发布且被编辑过,重合成将覆盖线上内容"
                : "关联文档在合成后被人工编辑过,重合成将确认后覆盖"
              : undefined
          }
        >
          {hasDoc ? "重合成(覆盖文档)" : "合成初稿"}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-text-2">
          撰写目的
          <select
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as TopicPurposeKey)}
            className="max-w-56 rounded-sm border border-line bg-panel px-2 py-1 text-[12px] outline-none focus:border-accent"
            aria-label="合成撰写目的"
          >
            {TOPIC_PURPOSES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <input
          value={extra}
          maxLength={200}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="补充要求(可选,如:重点展开需求清单那一节)"
          className="min-w-64 flex-1 rounded-sm border border-line bg-panel px-2 py-1 text-[12px] outline-none focus:border-accent placeholder:text-text-3"
          aria-label="合成补充要求"
        />
        {hasDoc && (
          <Link
            href={`/admin/posts/${linkedPostId}`}
            className="rounded-sm border border-line px-2.5 py-1 text-xs text-text-2 hover:border-accent hover:text-text-1"
          >
            跳转文档(人工定稿)
          </Link>
        )}
      </div>
      <span className="text-[11px] text-text-3">
        在右侧 AI 对话框执行:agent 自主编排(读素材→选题→写作→配图→落库);模型走 「Agent 搜索」绑定
      </span>
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
