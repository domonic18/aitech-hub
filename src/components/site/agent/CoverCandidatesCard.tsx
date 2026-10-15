"use client";

/**
 * 封面候选 HITL 卡(M31 验收反馈):agent generate_post_cover 中断的确认面——
 * 候选图预览 + 每张「入库」钮 + 整批「全部放弃」。取图经 fetch 带
 * x-cover-token 头再转 blob(批④:token 不进 URL,不落访问/代理日志),点选
 * 经 useLangGraphSendCommand 回灌 Command({resume});adopt 才真正入媒体库
 * (工具体内执行)。中断清位同 ask_user:resume run 首个 updates 帧自动消卡。
 */
import {
  useLangGraphInterruptState,
  useLangGraphSendCommand,
  type LangGraphCommand,
} from "@assistant-ui/react-langgraph";
import { useEffect, useState } from "react";

import {
  buildCoverResumeCommand,
  parseAgentCoverInterrupt,
  type AgentCoverResume,
} from "@/lib/agent/cover-tool";

/** 单张候选取图(blob 进 objectURL;失败留占位,决策面兜底) */
function CandidateImage({ url, token }: { url: string; token: string }): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let alive = true;
    fetch(url, { headers: { "x-cover-token": token } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`取图失败(${r.status})`))))
      .then((b) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(b);
        setSrc(objectUrl);
      })
      .catch(() => {
        // 取图失败:占位块示意,不影响「放弃」决策;入库须图在,失败态可重开线程重生成
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, token]);

  if (src === null) {
    return <div className="aspect-video w-full animate-pulse bg-panel-2" aria-label="候选加载中" />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- blob 本地回显,无优化面
  return <img src={src} alt="封面候选" className="aspect-video w-full object-cover" />;
}

export default function CoverCandidatesCard(): React.ReactElement | null {
  const interrupt = useLangGraphInterruptState();
  const sendCommand = useLangGraphSendCommand();
  const [submitting, setSubmitting] = useState(false);

  if (interrupt === undefined) return null;
  const payload = parseAgentCoverInterrupt(interrupt.value);
  if (!payload) return null;

  const submit = async (resume: AgentCoverResume): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await sendCommand(buildCoverResumeCommand(resume) as unknown as LangGraphCommand);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t border-line p-3" aria-label="封面候选确认">
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10.5px] text-accent">
        <svg className="ic" aria-hidden="true">
          <use href="#i-robot" />
        </svg>
        封面候选 · 等待你确认
      </div>
      <p
        className="mb-2 line-clamp-2 text-[11px] leading-relaxed text-text-3"
        title={payload.prompt}
      >
        提示词:{payload.prompt}
      </p>
      <div className="mb-2 grid grid-cols-2 gap-2">
        {payload.candidates.map((c) => (
          <div key={c.id} className="overflow-hidden rounded-sm border border-line">
            <CandidateImage url={c.url} token={payload.token} />
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit({ decision: "adopt", candidateId: c.id })}
              className="w-full cursor-pointer border-t border-line bg-panel px-2 py-1.5 text-[11px] text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              入库这张
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={submitting}
        onClick={() => void submit({ decision: "discard" })}
        className="cursor-pointer rounded-sm border border-line px-2.5 py-1 text-[11px] text-text-3 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        全部放弃(不落库)
      </button>
    </div>
  );
}
