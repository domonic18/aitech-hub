"use client";

/**
 * 人工答复(M66 会话详情页):写一段答复排队,用户下次在公众号发言时由被动回复
 * 带出一次并自动清空(认证订阅号无客服消息权限,无法主动推送)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

interface ApiBody {
  code: number;
  message?: string;
}

export default function ManualReplyControl({
  sessionId,
  pending,
  pendingAt,
  expired,
  ttlDays,
}: {
  sessionId: string;
  /** 已排队的答复正文;null = 队列空 */
  pending: string | null;
  /** 入队时间(已格式化;由页面渲染,避免客户端时区漂移) */
  pendingAt: string | null;
  /** 已超过有效期(下次发言时会被静默作废) */
  expired: boolean;
  ttlDays: number;
}): React.ReactElement {
  const router = useRouter();
  const [text, setText] = useState(pending ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/wechat-mp/sessions/${sessionId}/reply`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify({ text: text.trim() }) : undefined,
      });
      const body = (await res.json().catch(() => null)) as ApiBody | null;
      if (!res.ok || body?.code !== 0) {
        setError(body?.message ?? "操作失败,请重试");
        return;
      }
      if (method === "DELETE") setText("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const queued = Boolean(pending) && !expired;

  return (
    <section className="flex flex-col gap-2 rounded-md border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-xs font-semibold text-text-1">人工答复</h3>
        <span className="text-[11px] text-text-3">
          保存后不会立即发出——认证订阅号无客服消息权限,用户下次发任意消息时才送达,有效期 {ttlDays}{" "}
          天
        </span>
      </div>

      {queued ? (
        <div className="rounded-sm border border-accent/30 bg-accent-dim px-3 py-2 text-[11px] text-text-2">
          <span className="font-medium text-accent">已排队</span>
          <span className="ml-2 text-text-3">入队于 {pendingAt}</span>
          <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-text-1">{pending}</p>
        </div>
      ) : null}

      {pending && expired ? (
        <p className="text-[11px] text-amber-hi">
          上一条答复已于 {pendingAt} 入队,超过 {ttlDays} 天有效期,用户下次发言时会被作废;
          可重新保存覆盖。
        </p>
      ) : null}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        rows={4}
        placeholder="写给你这个用户的答复……"
        className="w-full resize-y rounded-sm border border-line bg-panel-2 px-2 py-1.5 text-[13px] text-text-1 outline-none focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void call("POST")}
          disabled={busy || text.trim() === ""}
          className="cursor-pointer rounded-sm bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "提交中…" : pending ? "覆盖保存" : "保存待投递"}
        </button>
        {pending ? (
          <button
            type="button"
            onClick={() => void call("DELETE")}
            disabled={busy}
            className="cursor-pointer rounded-sm border border-line bg-panel px-3 py-1 text-xs text-text-2 hover:border-line-hover hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-60"
          >
            撤销
          </button>
        ) : null}
        {error && <span className="text-[11px] text-red">{error}</span>}
      </div>
    </section>
  );
}
