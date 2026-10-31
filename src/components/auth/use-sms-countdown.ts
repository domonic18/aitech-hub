"use client";

/**
 * 验证码按钮本地倒计时(M65):登录页与账号中心绑定手机号共用。
 * 仅做体验(避免连点),真正的 60 秒冷却在服务端 Redis(limit.ts)。
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** 与 PNVS `interval` 参数同值 */
export const SMS_RESEND_SECONDS = 60;

export function useSmsCountdown(): { countdown: number; start: () => void } {
  const [countdown, setCountdown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback((): void => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback((): void => {
    setCountdown(SMS_RESEND_SECONDS);
    stop();
    timer.current = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          stop();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  }, [stop]);

  return { countdown, start };
}
