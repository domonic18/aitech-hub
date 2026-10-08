"use client";

/**
 * 解锁卡(M21 批③,门禁客户端 island):ISR 预览页挂载后查 /api/pay/access
 * ——已持有权益 → 拉全文(/api/pay/content,no-store)原位替换预览;未持有
 * 按收银台形态渲染:off=联系站长 / 未登录=登录引导(D1)/ mock=模拟支付 /
 * xunhu=创建订单跳收银链。预览正文由服务端组件传入,本组件永不回退展示全文。
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import ArticleBody from "@/components/article/ArticleBody";

interface AccessState {
  loggedIn: boolean;
  hasAccess: boolean;
  mode: "off" | "mock" | "xunhu";
}

const FALLBACK_PRICE = "5.00";

export default function PayGateCard({
  postId,
  price,
  previewMd,
  previewHtml,
}: {
  postId: string;
  price: string;
  previewMd: string | null;
  previewHtml: string | null;
}) {
  const [access, setAccess] = useState<AccessState | null>(null);
  const [full, setFull] = useState<{ contentMd: string | null; contentHtml: string | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/pay/access?postId=${postId}`)
      .then((r) => r.json())
      .then((b) => setAccess(b.data ?? null))
      .catch(() => setAccess(null));
  }, [postId]);

  const unlock = useCallback(async () => {
    if (!access) return;
    if (!access.loggedIn) {
      window.location.href = "/login";
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pay/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      const body = (await res.json()) as {
        code: number;
        message?: string;
        data?: { orderNo: string; payUrl: string };
      };
      if (body.code !== 0 || !body.data) {
        setError(body.message ?? `HTTP ${res.status}`);
        return;
      }
      const { orderNo, payUrl } = body.data;
      if (payUrl.startsWith("mock://")) {
        const done = await fetch("/api/pay/mock/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderNo }),
        });
        const doneBody = (await done.json()) as { code: number; message?: string };
        if (doneBody.code !== 0) {
          setError(doneBody.message ?? "模拟支付失败");
          return;
        }
        window.location.reload(); // mock 全链路完成,刷新走已解锁态
        return;
      }
      // xunhu → 本站收银台页(§8 批⑤):倒计时+二维码+轮询,完成自动跳回本文
      window.location.href = `/pay/${orderNo}`;
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [access, postId]);

  // 权益就绪 → 拉全文(显式 no-store,门禁最后防线在服务端)
  useEffect(() => {
    if (!access?.hasAccess) return;
    fetch(`/api/pay/content?postId=${postId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b?.data && setFull(b.data))
      .catch(() => setError("正文加载失败,请刷新重试"));
  }, [access, postId]);

  if (full) {
    return (
      <div className="mt-8">
        <ArticleBody contentMd={full.contentMd} contentHtml={full.contentHtml} />
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="prose pointer-events-none select-none opacity-60">
        <ArticleBody contentMd={previewMd} contentHtml={previewHtml} />
      </div>
      <div className="relative -mt-10 flex flex-col items-center gap-2 rounded-md border border-line bg-panel px-6 py-5">
        <p className="text-sm text-text-2">本文为付费内容,剩余部分解锁后阅读</p>
        <p className="font-mono text-lg font-semibold text-accent">¥{price || FALLBACK_PRICE}</p>
        {access && !access.hasAccess ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void unlock()}
            className="cursor-pointer rounded-sm bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "处理中…" : access.mode === "off" ? "联系站长开通" : "解锁全文"}
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="rounded-sm bg-accent/50 px-4 py-2 text-xs text-white"
          >
            加载中…
          </button>
        )}
        {error && <p className="font-mono text-[11px] text-red">{error}</p>}
        {access && !access.loggedIn && (
          <p className="text-[11px] text-text-3">
            已有账号?
            <Link href="/login" className="text-accent hover:underline">
              直接登录
            </Link>
            ;没有账号?解锁时按引导注册。
          </p>
        )}
        <p className="font-mono text-[10px] text-text-3">
          微信支付 · 权益实时到账 · 订单问题请联系站长
        </p>
      </div>
    </div>
  );
}
