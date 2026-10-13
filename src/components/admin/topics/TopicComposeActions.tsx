"use client";

/**
 * 专题合成操作区 + 侧边栏 agent 承载(M27 批④,1276 验收反馈「点击合成要有
 * 过程」):点「合成初稿/重合成」唤起右下角助手卡(embedded AssistantCard,
 * admin 会话即 member)并注入合成任务——agent 以 write_todos 列计划后调
 * compose_topic_draft 工具,四步管线进度在工具卡实时滚动,完成后在对话框
 * 汇报并给文档链接;回写库由 worker 管线落稿(共享锚定核,与按钮轮询时代
 * 一致)。空素材在按钮侧就地拦截(零真网防线,e2e 34 断言同文);重合成的
 * 覆盖确认由工具 needConfirm → agent ask_user 回路承接。
 */
import { useRef, useState } from "react";
import Link from "next/link";

import AssistantCard from "@/components/site/assistant/AssistantCard";

/** 转交助手卡的预置任务(nonce 变化即重新注入,AssistantCard 同款契约) */
type InjectComposeAsk = { question: string; send: true; nonce: number };

export default function TopicComposeActions({
  topicId,
  topicTitle,
  materialsCount,
  linkedPostId,
  linkedPostStatus,
  editedSinceCompose,
}: {
  topicId: string;
  topicTitle: string;
  /** 挂载素材数(0 = 按钮侧就地拦截,不开抽屉) */
  materialsCount: number;
  linkedPostId: string | null;
  /** 关联文档状态(重合成提示口径:published 覆盖即上线内容变更) */
  linkedPostStatus: string | null;
  /** 服务端预判:合成后被人工编辑过(按钮 title 提示,实际判定以工具 needConfirm 为准) */
  editedSinceCompose: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [injectAsk, setInjectAsk] = useState<InjectComposeAsk | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const askSeq = useRef(0);

  /** 唤起助手卡并注入合成任务;素材空就地拦截(与 API 预检同文人话) */
  function compose(): void {
    if (materialsCount === 0) {
      setMsg({ tone: "err", text: "尚未挂载素材——先挂 2~3 条解读/文章再合成" });
      return;
    }
    setMsg(null);
    setInjectAsk({
      question: linkedPostId
        ? `请为专题《${topicTitle}》(专题 id:${topicId})重新合成推荐文章,将覆盖关联文档`
        : `请为专题《${topicTitle}》(专题 id:${topicId})合成推荐文章初稿`,
      send: true,
      nonce: ++askSeq.current,
    });
    setOpen(true);
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
        {hasDoc && (
          <Link
            href={`/admin/posts/${linkedPostId}`}
            className="rounded-sm border border-line px-2.5 py-1 text-xs text-text-2 hover:border-accent hover:text-text-1"
          >
            跳转文档(人工定稿)
          </Link>
        )}
        <span className="text-[11px] text-text-3">
          在右侧 AI 对话框执行:四步生成(角度→起草→自检→修订)约 1~3 分钟;需在 AI
          配置绑定「专题合成」模型
        </span>
      </div>
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
      {open && (
        <AssistantCard
          embedded
          onClose={() => setOpen(false)}
          onHide={() => setOpen(false)}
          injectAsk={injectAsk}
        />
      )}
    </div>
  );
}
