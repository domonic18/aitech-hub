"use client";

/**
 * 批量动作状态与执行收口(技术债批②,五表编排唯一实现):
 * - useBatchState:busy/msg/error 三态(同步面与 job 化轮询面共用);
 * - useBatchAction:三态 + runBatch 统一流程——confirm 拒绝即中止 → postBatch
 *   → 成功 outcomeText+清选择+refresh / 失败人话 error。
 */
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { outcomeText, postBatch } from "./batch-client";

export interface BatchActionConfig {
  url: string;
  body: unknown;
  /** 危险动作确认文案(在场则 window.confirm,拒绝即中止) */
  confirm?: string;
  /** 结果文案前缀(送 outcomeText,如「已删除」;缺省「已处理」) */
  donePrefix?: string;
  /** 失败兜底文案(响应无 message 时,如代理 HTML 错误页) */
  fallbackError?: string;
}

/** 批量动作三态(纯状态;同步批删与 job 化轮询两个面共用) */
export function useBatchState(): {
  busy: boolean;
  msg: string | null;
  error: string | null;
  setBusy: (v: boolean) => void;
  setMsg: (v: string | null) => void;
  setError: (v: string | null) => void;
} {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return { busy, msg, error, setBusy, setMsg, setError };
}

/** 同步批量动作完整编排(五表批量删除/归档/隐藏/生效/弃用/停启用唯一实现) */
export function useBatchAction(clearSelected: () => void): {
  busy: boolean;
  msg: string | null;
  error: string | null;
  runBatch: (cfg: BatchActionConfig) => void;
} {
  const router = useRouter();
  const { busy, msg, error, setBusy, setMsg, setError } = useBatchState();

  // postBatch 内部自捕获网络异常(永不 reject),无 unhandled rejection 面
  const runBatch = useCallback(
    (cfg: BatchActionConfig): void => {
      if (cfg.confirm !== undefined && !window.confirm(cfg.confirm)) return;
      setBusy(true);
      setError(null);
      setMsg(null);
      void postBatch(cfg.url, cfg.body).then((r) => {
        if (r.ok && r.data) {
          setMsg(outcomeText(cfg.donePrefix ?? "已处理", r.data));
          clearSelected();
          router.refresh();
        } else {
          setError(r.message ?? cfg.fallbackError ?? "批量操作失败");
        }
        setBusy(false);
      });
    },
    [setBusy, setMsg, setError, clearSelected, router],
  );

  return { busy, msg, error, runBatch };
}
