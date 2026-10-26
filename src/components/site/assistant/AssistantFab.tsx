"use client";
/**
 * 悬浮助手 FAB = 全站唯一 Agent 宿主(M35 宿主唯一化,挂根 layout):跨路由
 * 持久(App Router layout 不随子路由切换卸载),卡片首开才挂(零前置开销),
 * 此后关闭/隐藏/切页仅 display:none——在跑 agent run 不随任何页面切换中断,
 * 再开即回(ai-invest 同款;M31 验收实证:页面自持卡会随路由卸载杀 run,
 * 故宿主唯一化,页面接入只走 src/lib/agent/agent-host.ts 两协议)。显隐
 * 口径:登录身份读 UserAccount.assistantVisible(session API 下发,隐藏走
 * PATCH 账号级跨设备);游客 localStorage(键独立,互不影响);隐藏后留极小
 * 唤起点(行业惯例,否则无处再呼出)。SSR 恒 null,身份判定全在客户端挂载后
 * (免水合不一致)。按钮显隐路由策略见 agentFabButtonVisible(编辑页顶栏
 * EditorAssistant 入口在场、登录页聚焦,均藏钮不卸卡)。
 */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  AGENT_OPEN_EVENT,
  AGENT_SURFACE_ANNOUNCE_EVENT,
  AGENT_SURFACE_EVENT,
  agentFabButtonVisible,
} from "@/lib/agent/agent-host";
import type { EditSurfaceContext } from "@/components/site/agent/AgentThread";

import AssistantCard from "./AssistantCard";

const SESSION_STATE_URL = "/api/auth/session";
const ASSISTANT_VISIBLE_URL = "/api/account/assistant-visible";
/** 游客显隐 localStorage 键(登录身份不用它) */
const GUEST_VISIBLE_KEY = "assistant.guest.visible";

/** 唤起时注入卡片的问题(nonce 驱动 Card 侧 effect,同问句可重复注入) */
type InjectAsk = { question: string; send: boolean; nonce: number };

export default function AssistantFab(): React.ReactElement | null {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  /** null=加载中;true/false=显/隐(FAB 退化唤起点) */
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  /** 首开后卡片恒挂载:关闭/隐藏/切页仅 display:none,在跑 run 不中断(常驻化) */
  const [everOpened, setEverOpened] = useState(false);
  /** member 身份缓存(决定隐藏写库还是 localStorage) */
  const [isMember, setIsMember] = useState(false);
  /** agent:open 携带的预置问题(空 detail 不注入) */
  const [injectAsk, setInjectAsk] = useState<InjectAsk | null>(null);
  /** 能力注册协议(②):编辑面接线对象,编辑页在场才有(注销即 null) */
  const [editSurface, setEditSurface] = useState<EditSurfaceContext | null>(null);

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
      setEverOpened(true);
      setOpen(true);
    };
    window.addEventListener(AGENT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(AGENT_OPEN_EVENT, onOpen);
  }, []);

  // 能力注册协议:编辑页挂载注册/卸载注销(句柄身份稳定,setter 同值 bail-out);
  // 监听挂载后广播重报,补偿页面编辑面注册先于本监听的时序竞态(见协议模块)
  useEffect(() => {
    const onSurface = (e: Event): void => {
      setEditSurface((e as CustomEvent<EditSurfaceContext | null>).detail ?? null);
    };
    window.addEventListener(AGENT_SURFACE_EVENT, onSurface);
    window.dispatchEvent(new CustomEvent(AGENT_SURFACE_ANNOUNCE_EVENT));
    return () => window.removeEventListener(AGENT_SURFACE_EVENT, onSurface);
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

  // 路由策略:编辑页/登录页藏按钮(卡若已挂载仍常驻渲染,run 不中断)
  const buttonVisible = pathname === null || agentFabButtonVisible(pathname);

  if (!buttonVisible) {
    return everOpened ? (
      <div className={open ? "contents" : "hidden"}>
        <AssistantCard
          onClose={() => setOpen(false)}
          onHide={onHide}
          injectAsk={injectAsk}
          editContext={editSurface}
        />
      </div>
    ) : null;
  }

  if (!visible) {
    // 极小唤起点:隐藏后的兜底入口(点它直开卡片,显隐态不变;卡片若已挂载
    // 则保持常驻仅转显,在跑 run 不中断)
    return (
      <>
        {everOpened && (
          <div className={open ? "contents" : "hidden"}>
            <AssistantCard
              onClose={() => setOpen(false)}
              onHide={onHide}
              injectAsk={injectAsk}
              editContext={editSurface}
            />
          </div>
        )}
        <button
          type="button"
          aria-label="唤起 AI 助手"
          onClick={() => {
            setEverOpened(true);
            setOpen(true);
          }}
          className="fixed bottom-5 right-4 z-40 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-line bg-panel text-text-3 opacity-50 transition-opacity hover:opacity-100 sm:right-5"
        >
          <svg className="ic" aria-hidden="true">
            <use href="#i-robot" />
          </svg>
        </button>
      </>
    );
  }

  return (
    <>
      {everOpened && (
        <div className={open ? "contents" : "hidden"}>
          <AssistantCard
            onClose={() => setOpen(false)}
            onHide={onHide}
            injectAsk={injectAsk}
            editContext={editSurface}
          />
        </div>
      )}
      <button
        type="button"
        aria-label="打开 AI 助手"
        onClick={() => {
          setEverOpened(true);
          setOpen((v) => !v);
        }}
        className="fixed bottom-5 right-4 z-40 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-accent text-white shadow-md transition-transform hover:scale-105 hover:bg-accent-hover sm:right-5"
      >
        <svg className="ic ic-lg" aria-hidden="true">
          <use href="#i-robot" />
        </svg>
      </button>
    </>
  );
}
