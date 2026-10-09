"use client";
/**
 * 悬浮助手 FAB(M22 批④,需求6/7):全站右下角圆形唤起钮,点开
 * AssistantCard。显隐口径:登录身份读 UserAccount.assistantVisible(session
 * API 下发,隐藏走 PATCH 账号级跨设备);游客 localStorage(键独立,互不影响);
 * 隐藏后留极小唤起点(行业惯例,否则无处再呼出)。全局唤起协议:
 * CustomEvent("agent:open", {detail:{mode}})(批⑤「联系我们」消费;
 * 与 /search 抽屉的 search:agent-ask 互不干扰)。SSR 恒 null,身份判定
 * 全在客户端挂载后(免水合不一致)。
 */
import { useCallback, useEffect, useState } from "react";

import type { PendingAsk } from "@/components/site/agent/AgentThread";

import AssistantCard from "./AssistantCard";

const SESSION_STATE_URL = "/api/auth/session";
const ASSISTANT_VISIBLE_URL = "/api/account/assistant-visible";
/** 游客显隐 localStorage 键(登录身份不用它) */
const GUEST_VISIBLE_KEY = "assistant.guest.visible";

/** 唤起时注入卡片的问题(nonce 驱动 Card 侧 effect,同问句可重复注入) */
type InjectAsk = PendingAsk & { nonce: number };

export default function AssistantFab(): React.ReactElement | null {
  const [ready, setReady] = useState(false);
  /** null=加载中;true/false=显/隐(FAB 退化唤起点) */
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  /** member 身份缓存(决定隐藏写库还是 localStorage) */
  const [isMember, setIsMember] = useState(false);
  /** agent:open 携带的预置问题(批⑤「联系我们」;空 detail 不注入) */
  const [injectAsk, setInjectAsk] = useState<InjectAsk | null>(null);

  // 挂载判身份与显隐初值(登录=服务端字段;游客=localStorage 默认显)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(SESSION_STATE_URL);
        const body = (await res.json()) as {
          code: number;
          data?: { user?: { assistantVisible?: boolean } | null };
        };
        if (cancelled) return;
        const user = body.code === 0 ? body.data?.user : undefined;
        if (user) {
          setIsMember(true);
          setVisible(user.assistantVisible !== false);
        } else {
          setVisible(window.localStorage.getItem(GUEST_VISIBLE_KEY) !== "0");
        }
      } catch {
        if (!cancelled) setVisible(true); // 查询失败按默认显兜底(后端同口径)
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hide = useCallback((): void => {
    setOpen(false);
    setVisible(false);
    if (!isMember) window.localStorage.setItem(GUEST_VISIBLE_KEY, "0");
  }, [isMember]);

  // 全局唤起协议(detail.ask 有值则注入卡片直发;隐藏态同样响应)
  useEffect(() => {
    const onOpen = (e: Event): void => {
      const detail = (e as CustomEvent<{ ask?: { question?: unknown; send?: unknown } }>).detail;
      if (typeof detail?.ask?.question === "string" && detail.ask.question.trim() !== "") {
        setInjectAsk({
          question: detail.ask.question,
          send: detail.ask.send === true,
          nonce: Date.now(),
        });
      }
      setOpen(true);
    };
    window.addEventListener("agent:open", onOpen);
    return () => window.removeEventListener("agent:open", onOpen);
  }, []);

  // 隐藏操作来自卡片内(登录身份持久化到账号)
  const persistHide = useCallback((): void => {
    void fetch(ASSISTANT_VISIBLE_URL, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visible: false }),
    }).catch(() => undefined);
  }, []);

  const onHide = useCallback((): void => {
    hide();
    if (isMember) persistHide();
  }, [hide, isMember, persistHide]);

  if (!ready) return null;

  if (!visible) {
    // 极小唤起点:隐藏后的兜底入口(点它直开卡片,显隐态不变)
    return (
      <button
        type="button"
        aria-label="唤起 AI 助手"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-4 z-40 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-line bg-panel text-text-3 opacity-50 transition-opacity hover:opacity-100 sm:right-5"
      >
        <svg className="ic" aria-hidden="true">
          <use href="#i-robot" />
        </svg>
      </button>
    );
  }

  return (
    <>
      {open && (
        <AssistantCard onClose={() => setOpen(false)} onHide={onHide} injectAsk={injectAsk} />
      )}
      <button
        type="button"
        aria-label="打开 AI 助手"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-4 z-40 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-accent text-white shadow-md transition-transform hover:scale-105 hover:bg-accent-hover sm:right-5"
      >
        <svg className="ic ic-lg" aria-hidden="true">
          <use href="#i-robot" />
        </svg>
      </button>
    </>
  );
}
