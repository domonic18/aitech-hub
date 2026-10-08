"use client";

/**
 * 收银台面板(M21 批⑤,提案 §8):金额 + 倒计时 + 支付入口(虎皮椒 H5 链
 * 新开 + PC 二维码)+ 3s 轮询订单状态,paid/refunded 即跳回文章;mock 模式
 * 直达模拟支付;过期给重新下单(旧单过期不复用,新单新号 router.replace)。
 * 收银链经下单接口现取(复用未付单同单号,虎皮椒链 5min 时效不过期)。
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface OrderBody {
  code: number;
  message?: string;
  data?: { orderNo: string; payUrl: string; amount: string; expiresAt: string } | null;
}

type Phase = "init" | "ready" | "done" | "expired" | "error";

const POLL_MS = 3000;

export default function CheckoutPanel({
  orderNo,
  postId,
  amount,
  title,
  status,
  backPath,
}: {
  orderNo: string;
  postId: string;
  amount: string;
  title: string;
  status: string;
  backPath: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("init");
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [leftText, setLeftText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const orderRef = useRef(orderNo);

  const finish = useCallback(() => {
    setPhase("done");
    // 已解锁态由文章页 island 实时判定(access/content no-store),整跳即见全文
    window.location.href = backPath;
  }, [backPath]);

  // 轮询:paid/refunded 终态跳回;closed→过期态展示重下入口
  useEffect(() => {
    if (phase !== "ready") return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/pay/orders/${orderRef.current}`, { cache: "no-store" });
        const b = (await r.json()) as { code: number; data?: { status: string } | null };
        const s = b.data?.status;
        if (s === "paid") finish();
        else if (s === "refunded") finish();
        else if (s === "closed") setPhase("expired");
      } catch {
        // 单次轮询失败不中断(下一拍再取;对账 sweep 兜底)
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [phase, finish]);

  // 倒计时显示
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = setInterval(() => {
      const left = expiresAt - Date.now();
      if (left <= 0) {
        setLeftText("已过期");
        return;
      }
      const m = Math.floor(left / 60_000);
      const s = Math.floor((left % 60_000) / 1000);
      setLeftText(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  /** 取收银链(复用未付单同单号);mock 模式模拟支付后直接进入轮询 */
  const initCheckout = useCallback(async () => {
    setPhase("init");
    setError(null);
    try {
      const res = await fetch("/api/pay/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      const body = (await res.json()) as OrderBody;
      if (body.code !== 0 || !body.data) {
        setError(body.message ?? `HTTP ${res.status}`);
        setPhase("error");
        return;
      }
      orderRef.current = body.data.orderNo;
      setExpiresAt(new Date(body.data.expiresAt).getTime());
      if (body.data.payUrl.startsWith("mock://")) {
        // dev mock:模拟支付即 paid,轮询捕终态后跳回
        const done = await fetch("/api/pay/mock/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderNo: body.data.orderNo }),
        });
        const doneBody = (await done.json()) as { code: number; message?: string };
        if (doneBody.code !== 0) {
          setError(doneBody.message ?? "模拟支付失败");
          setPhase("error");
          return;
        }
      } else {
        setPayUrl(body.data.payUrl);
      }
      setPhase("ready");
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  }, [postId]);

  // 已付单(回访 /pay/<orderNo>)直接跳回,不再取链
  useEffect(() => {
    if (status === "paid" || status === "refunded") {
      finish();
      return;
    }
    if (status === "closed") {
      setPhase("expired");
      return;
    }
    void initCheckout();
  }, [status, finish, initCheckout]);

  /** 重新下单:旧单过期不复用,新单新号换址 */
  async function reorder(): Promise<void> {
    const res = await fetch("/api/pay/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postId }),
    });
    const body = (await res.json()) as OrderBody;
    if (body.code === 0 && body.data) {
      router.replace(`/pay/${body.data.orderNo}`); // 换新单号;panel 重挂载走 init
    } else {
      setError(body.message ?? "下单失败,请稍后再试");
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-md border border-line bg-panel px-6 py-8">
      <h1 className="text-base font-semibold text-text-1">收银台</h1>
      <p className="line-clamp-2 text-center text-xs text-text-2">{title || "付费内容解锁"}</p>
      <p className="font-mono text-3xl font-bold text-accent">¥{amount}</p>

      {phase === "init" && <p className="text-xs text-text-3">正在生成支付链接…</p>}

      {phase === "ready" && (
        <>
          <p className="text-xs text-text-2">
            订单号 <span className="font-mono">{orderRef.current}</span>
            {leftText && leftText !== "已过期" && (
              <span className="ml-2 font-mono text-text-3">剩余 {leftText}</span>
            )}
          </p>
          {qrUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- 网关动态二维码,外域链无 next/image 配置价值
            <img src={qrUrl} alt="支付二维码" className="h-44 w-44 rounded-sm border border-line" />
          )}
          {payUrl && (
            <a
              href={payUrl}
              target="_blank"
              rel="noreferrer"
              className="cursor-pointer rounded-sm bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover"
            >
              打开支付页面
            </a>
          )}
          <p className="text-[11px] text-text-3">支付完成后本页自动跳回文章;未支付可稍后重试</p>
        </>
      )}

      {phase === "done" && <p className="text-xs text-text-2">支付成功,正在跳回文章…</p>}

      {phase === "expired" && (
        <>
          <p className="text-xs text-text-2">订单已过期,请重新下单</p>
          <button
            type="button"
            onClick={() => void reorder()}
            className="cursor-pointer rounded-sm bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover"
          >
            重新下单
          </button>
        </>
      )}

      {phase === "error" && (
        <>
          <p className="font-mono text-[11px] text-red">{error}</p>
          <button
            type="button"
            onClick={() => void initCheckout()}
            className="cursor-pointer rounded-sm border border-line px-4 py-2 text-xs text-text-1 hover:border-line-hover"
          >
            重试
          </button>
        </>
      )}
      {error && phase !== "error" && <p className="font-mono text-[11px] text-red">{error}</p>}
    </div>
  );
}
