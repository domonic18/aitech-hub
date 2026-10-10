"use client";

/**
 * Footer「联系我们」(M22 批⑤,需求8):不走 mailto——派发全局 agent:open
 * 唤起悬浮助手并预置一条直发消息,由 AI 引导补全诉求与联系方式后经
 * submit_feedback 落反馈系统(未登录同样可用,游客配额天然覆盖)。
 */
const CONTACT_ASK = "我想联系站长反馈一些事情,请帮我提交反馈。";

export default function ContactLauncher(): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("agent:open", {
            detail: { mode: "contact", ask: { question: CONTACT_ASK, send: true } },
          }),
        )
      }
      className="cursor-pointer hover:text-text-1"
    >
      联系我们
    </button>
  );
}
