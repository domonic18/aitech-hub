"use client";

/**
 * 飞书工作台静默免登(M29 批②):仅飞书容器激活(UA 启发式,零 footprint),
 * h5sdk 取授权码 → POST /api/auth/feishu/exchange 服务端兑换发既有 jose 会话
 * Cookie → 整页跳 next(与 LoginForm 同款,确保 RSC 重取守卫)。任一步失败
 * 静默回落密码表单(人话提示一行,不阻塞不重试);非飞书环境渲染 null,
 * LoginForm 零改动零回归。
 */
import { useEffect, useRef, useState } from "react";

import { isFeishuWebview, requestFeishuAuthCode } from "@/lib/feishu/h5";
import type { ApiEnvelope } from "@/lib/http/response";

function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return next.startsWith("/admin") && !next.startsWith("//") ? next : "/admin";
}

export default function FeishuSilentLogin(): React.ReactElement | null {
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [reason, setReason] = useState<string | null>(null);
  const started = useRef(false); // dev StrictMode 双挂载只跑一次(授权码单次有效,省兑换配额)

  useEffect(() => {
    if (!isFeishuWebview() || started.current) return;
    started.current = true;
    setState("loading");
    (async (): Promise<void> => {
      try {
        const code = await requestFeishuAuthCode();
        const res = await fetch("/api/auth/feishu/exchange/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const body = (await res.json()) as ApiEnvelope;
        if (body.code === 0) {
          window.location.replace(safeNext()); // 整页跳转,确保 RSC 重新取守卫状态
          return;
        }
        setReason(body.message || `HTTP ${res.status}`);
      } catch (e) {
        setReason(e instanceof Error ? e.message : String(e));
      }
      setState("failed");
    })();
  }, []);

  if (state === "idle") return null;
  if (state === "loading") {
    return (
      <p className="mb-4 rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs text-text-2">
        正在通过飞书免登…
      </p>
    );
  }
  return (
    <p
      className="mb-4 rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs"
      style={{ color: "var(--red-hi)" }}
    >
      飞书免登未成({reason ?? "未知原因"}),请使用密码登录;绑定入口在后台「系统 → 飞书免登」。
    </p>
  );
}
