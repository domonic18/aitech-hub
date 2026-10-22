"use client";

/**
 * 创作产出动作区(M42 批④:自 TopicDraftActions 泛化)——产出区恒有
 * 「生成长文」「生成贴图」两个按钮,与主意图无关(主意图只决定新建默认与
 * agent 分支,不限制另一种产出)。两者均经唤起协议注入任务到全局宿主卡
 * (根 layout 常驻,跨页存活;页面禁止自持卡,M31 教训)。保留既有纪律:
 * - 体裁词由服务端 resolvePurpose 从长文配置派生后传入(无双入口漂移);
 * - 「补充要求」仅本次,不落库,拼进任务话术;
 * - 长文任务尾部固定追加封面免确认锚点;
 * - 空素材按钮侧就地拦截(零真网防线)。
 */
import { useState } from "react";

import { openAgentAssistant } from "@/lib/agent/agent-host";

/** 封面免确认档位锚点(2026-10-20 验收反馈问题二):任务话术尾部固定追加,
 * 把「创作出稿走封面自动档」写进任务指令本身,不依赖模型记忆任务来源 */
const COVER_AUTO_HINT = "。头图直接自动生成并采用(自动档),不要用 ask_user 向我确认封面方向或提示词";

export default function StudioActions({
  topicId,
  topicTitle,
  materialsCount,
  hasDoc,
  linkedPostStatus,
  editedSinceCompose,
  genreWord,
  hasPins,
  pinHint,
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
  /** 本创作是否已有贴图(按钮文案:生成/再生成一组) */
  hasPins: boolean;
  /** 贴图配置人话摘要(服务端 parse 派生,按钮旁只读展示) */
  pinHint: string;
}) {
  const [extra, setExtra] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const blocked = materialsCount === 0;

  function guard(): boolean {
    if (!blocked) return true;
    setMsg({ tone: "err", text: "还没有素材——先添加 2~3 条解读/文章/电报,再来创作" });
    return false;
  }

  /** 长文任务:体裁词 + 仅本次补充要求 + 封面自动档锚点 */
  function composeArticle(): void {
    if (!guard()) return;
    setMsg(null);
    const extraPart = extra.trim() ? `,补充要求:${extra.trim()}` : "";
    openAgentAssistant({
      question: hasDoc
        ? `请为创作《${topicTitle}》(创作 id:${topicId})重新生成长文初稿【${genreWord}】,将覆盖现有文档${extraPart}${COVER_AUTO_HINT}`
        : `请为创作《${topicTitle}》(创作 id:${topicId})生成长文初稿【${genreWord}】${extraPart}${COVER_AUTO_HINT}`,
      send: true,
    });
  }

  /** 贴图任务:配置与参照图由 brief 单点提供,产出落 save_topic_pin 草稿 */
  function composePin(): void {
    if (!guard()) return;
    setMsg(null);
    const extraPart = extra.trim() ? `,补充要求:${extra.trim()}` : "";
    openAgentAssistant({
      question:
        `请为创作《${topicTitle}》(创作 id:${topicId})生成一组贴图:按本创作的贴图配置与参照图执行` +
        `(先 get_topic_brief 读 pin_config 与 reference_candidates),出图后用 save_topic_pin 落库为草稿,` +
        `并汇报贴图与组装台链接${extraPart}`,
      send: true,
    });
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={composeArticle}
          className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90"
          title={
            editedSinceCompose
              ? linkedPostStatus === "published"
                ? "文档已发布且初稿后被编辑过,重新生成将覆盖线上内容"
                : "文档在初稿生成后被人工编辑过,重新生成将确认后覆盖"
              : undefined
          }
        >
          {hasDoc ? "重新生成长文" : "生成长文"}
        </button>
        <button
          type="button"
          onClick={composePin}
          className="rounded-sm border border-accent px-3 py-1 text-xs font-medium text-accent hover:bg-accent/12"
        >
          {hasPins ? "再生成一组贴图" : "生成贴图"}
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
        在右侧 AI 对话框执行:agent 自主编排(读素材→选角度→创作→落库),素材不足会先搜索并说明;
        贴图配置:{pinHint}
      </span>
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
