"use client";
/**
 * 改稿提案降级卡(M27 批⑧-c):propose_edits 中断到达但当前页面无评审面
 * (FAB/非编辑路由形态)时渲染——展示提案说明,自动 resume
 * {decision:"unavailable"} 让工具体返回 error 语义,agent 会引导管理员到
 * 文章编辑页使用编辑助手。零服务端状态(不查会话绑文章,KISS);自动
 * resume 仅触发一次(ref 防重复),失败落文案不阻塞后续对话。
 */
import { useLangGraphSendCommand, type LangGraphCommand } from "@assistant-ui/react-langgraph";
import { useEffect, useRef, useState } from "react";

import {
  buildProposeEditsResumeCommand,
  type ProposeEditsPayload,
} from "@/lib/agent/edit-proposal";

export default function ProposeUnavailableCard({
  payload,
}: {
  payload: ProposeEditsPayload;
}): React.ReactElement {
  const sendCommand = useLangGraphSendCommand();
  const resumedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    void sendCommand(
      buildProposeEditsResumeCommand({ decision: "unavailable" }) as unknown as LangGraphCommand,
    ).catch(() => setFailed(true));
  }, [sendCommand]);

  return (
    <div className="border-t border-line p-3" aria-label="改稿提案(当前页面无法评审)">
      <div className="mb-2 flex items-center gap-1.5 font-mono text-[10.5px] text-accent">
        <svg className="ic" aria-hidden="true">
          <use href="#i-edit" />
        </svg>
        改稿提案 · 当前页面无法评审
      </div>
      <p className="mb-1.5 text-[13.5px] leading-[1.7] text-text-1">{payload.note}</p>
      <p className="text-xs leading-[1.6] text-text-3">
        {failed
          ? "回执发送失败,可重试或直接在输入框告诉助手你的意见。"
          : "这里没有文章评审界面,提案未应用——正在通知助手,请到文章编辑页处理。"}
      </p>
    </div>
  );
}
