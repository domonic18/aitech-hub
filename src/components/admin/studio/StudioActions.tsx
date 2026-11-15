"use client";

/**
 * 创作条(2026-11-15 瘦身 B3 改造):站内生成入口下线后,创作条退化为
 * 「素材台账 + 导出给线下」的出口——
 * - 创作总闸开(`creation.agent_enabled`):保留原「生成长文 / 生成贴图」两钮
 *   (唤起侧边栏 agent),作为回滚路径(B3 前该能力在用,关闭后随时可恢复);
 * - 创作总闸关:只留「导出素材包」钮——把本创作的定位、写作配置、素材全集、
 *   指南清单导出成 JSON,交给线下 Claude Code 写作助手起稿(真相源在仓库
 *   `skills/writing/*.md`,线上与线下读同一份)。
 *
 * 两条分支的纪律不变:体裁词由服务端 resolvePurpose 派生后传入(无双入口
 * 漂移);空素材就地拦截(零真网防线)。
 */
import { useState } from "react";

import { openAgentAssistant } from "@/lib/agent/agent-host";
import type { GenerationBaseline } from "@/lib/topics/generation-state";

import { useStudioGeneration } from "./StudioGenerationProvider";

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
  outputType,
  baseline,
  creationEnabled,
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
  /** 贴图配置人话摘要(服务端 parse 派生,说明行只读展示) */
  pinHint: string;
  /** 主意图(标题态机「下一步」引导口径:pin 先贴图,post 先长文) */
  outputType: string;
  /** 点击生成时的落库基线(生成态轮询比对用,服务端下发) */
  baseline: GenerationBaseline;
  /** 站内 AI 生成总闸(关 = 创作已外移线下,只留导出素材包) */
  creationEnabled: boolean;
}) {
  const { generating, completed, start } = useStudioGeneration();
  const [extra, setExtra] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
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
    start("post", baseline);
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
    start("pin", baseline);
  }

  /** 导出素材包:定位 + 写作配置 + 素材全集 + 指南清单 → JSON 文件 */
  async function exportBundle(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/topics/${topicId}/export`);
      const body = (await res.json()) as { code: number; message: string; data?: unknown };
      if (!res.ok || body.code !== 0) {
        setMsg({ tone: "err", text: body.message || "导出失败" });
        return;
      }
      const blob = new Blob([JSON.stringify(body.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `topic-${topicId}-materials.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg({ tone: "ok", text: "素材包已导出——交给线下写作助手起稿,出稿后上传落草稿" });
    } catch {
      setMsg({ tone: "err", text: "导出失败(网络异常)" });
    } finally {
      setExporting(false);
    }
  }

  /** 标题态机(M44 决策④):优先级 生成中 > 刚完成 > 无素材 > 无产出 > 稳态 */
  function headline(): { title: string; hint: string } {
    if (!creationEnabled) {
      return {
        title: "创作 · 导出给线下",
        hint: "站内生成已下线:把本创作的定位、素材与指南导出成素材包,交给线下写作助手起稿",
      };
    }
    if (generating) {
      return {
        title: "创作动作 · 生成中",
        hint:
          generating === "pin"
            ? "贴图正在由 AI 助手生成,完成后舞台自动刷新并高亮新产出"
            : "长文初稿正在由 AI 助手撰写,完成后舞台自动刷新",
      };
    }
    if (completed) {
      if (completed.outcome === "no-output") {
        return {
          title: "创作动作 · 本轮未产出",
          hint: "生成已结束但没有新产出——原因见右侧助手对话;调整后可重新生成",
        };
      }
      return {
        title: "创作动作 · 本轮已完成 ✓",
        hint: "产出已就位;可发布/精修,或调整配置后再次生成",
      };
    }
    if (blocked) {
      return {
        title: "先准备素材",
        hint: "在左侧挂 2~3 条解读/文章/电报,创作的质量取决于素材本身",
      };
    }
    if (!hasDoc && !hasPins) {
      const first = outputType === "pin" ? "生成贴图" : "生成长文";
      return {
        title: "下一步:生成初稿",
        hint: `素材已就绪——建议先「${first}」;另一种产出随时可切`,
      };
    }
    return {
      title: linkedPostStatus === "published" ? "创作动作 · 长文已发布 ✓" : "创作动作",
      hint: "可生成另一种产出,或调整配置后重新生成(覆盖已有产出前会确认)",
    };
  }
  const head = headline();

  return (
    // 外框(边框/吸附/阴影)由 StudioWorkbench 创作条槽位承担,本件只管内容
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* barLeft:状态标题 + hint 行 */}
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-semibold text-text-1">{head.title}</span>
          <span className="text-[11px] text-text-3">{head.hint}</span>
        </div>
        {/* barRight:导出素材包(总闸关)或原两钮(总闸开,回滚路径) */}
        <div className="ml-auto flex items-center gap-2">
          {!creationEnabled ? (
            <button
              type="button"
              onClick={() => void exportBundle()}
              disabled={exporting}
              className="rounded-sm bg-accent px-4 py-2 text-[13px] font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              title="导出本创作的定位、素材与指南清单(给线下写作助手)"
            >
              {exporting ? "导出中…" : "导出素材包"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={composeArticle}
                disabled={generating !== null}
                className="rounded-sm bg-accent px-4 py-2 text-[13px] font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                title={
                  editedSinceCompose
                    ? linkedPostStatus === "published"
                      ? "文档已发布且初稿后被编辑过,重新生成将覆盖线上内容"
                      : "文档在初稿生成后被人工编辑过,重新生成将确认后覆盖"
                    : undefined
                }
              >
                {generating === "post" ? "生成中…" : hasDoc ? "重新生成长文" : "生成长文"}
              </button>
              <button
                type="button"
                onClick={composePin}
                disabled={generating !== null}
                className="rounded-sm border border-accent px-4 py-2 text-[13px] font-medium text-accent hover:bg-accent/12 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating === "pin" ? "生成中…" : hasPins ? "再生成一组贴图" : "生成贴图"}
              </button>
            </>
          )}
        </div>
      </div>
      {/* 补充要求:折叠收纳(仅本次,不落库,拼进任务话术)——仅总闸开时有意义 */}
      {creationEnabled && (
        <details className="min-w-0">
          <summary className="cursor-pointer select-none text-[11px] text-text-3 hover:text-text-2">
            补充要求(仅本次,不落库){extra.trim() ? ` · 已填 ${extra.trim().length} 字` : ""}
          </summary>
          <input
            value={extra}
            maxLength={200}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="本次补充要求(如:重点展开需求清单那一节)"
            className="mt-1.5 w-full rounded-sm border border-line bg-panel px-2 py-1 text-[12px] outline-none focus:border-accent placeholder:text-text-3"
            aria-label="本次补充要求"
          />
        </details>
      )}
      <span className="text-[11px] text-text-3">
        {creationEnabled
          ? "在右侧 AI 对话框执行:agent 自主编排(读素材→选角度→创作→落库),素材不足会先搜索并说明;贴图配置:"
          : "素材包含:创作定位与写作配置、素材全集(解读/文章/视频)、绑定指南全文与指南清单;线下起稿后按整包上传落草稿("}
        {creationEnabled ? pinHint : "发布仍由站长在后台人工执行)"}
      </span>
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
