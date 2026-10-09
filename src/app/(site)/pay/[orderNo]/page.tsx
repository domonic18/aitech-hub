/**
 * 收银台页(M21 批⑤,提案 §8 /pay/[orderNo]):二维码 + 倒计时 + 轮询 +
 * 支付完成自动跳回文章。RSC 只做归属校验与回跳锚派生(登录必需——订单
 * 归属语义;收银链/二维码由 island 复用下单接口现取,5min 时效不过期)。
 * 无 SEO 价值,force-dynamic。
 */
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";

import CheckoutPanel from "@/components/pay/CheckoutPanel";
import { ACCESS_COOKIE_NAME } from "@/lib/auth/constants";
import { verifyAccessToken } from "@/lib/auth/session";
import { postPath } from "@/lib/content/post-path";
import { prisma } from "@/lib/db";
import { getOrderView } from "@/lib/pay/order-service";

export const dynamic = "force-dynamic";

const ORDER_NO_RE = /^[A-Za-z0-9]{8,32}$/;

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ orderNo: string }>;
}): Promise<React.ReactElement> {
  const { orderNo } = await params;
  if (!ORDER_NO_RE.test(orderNo)) notFound();

  const store = await cookies();
  // 单一契约(session.ts):只吃裸 token 值,解析交给框架 cookies();
  // 曾传完整 Cookie 头给读侧解析器 → 恒判未登录,收银台死循环弹登录(生产实证)
  const session = await verifyAccessToken(store.get(ACCESS_COOKIE_NAME)?.value ?? null);
  if (!session) redirect(`/login?next=${encodeURIComponent(`/pay/${orderNo}`)}`);

  const view = await getOrderView(orderNo, BigInt(session.sub), session.role === "admin");
  if (!view) notFound();

  // 回跳锚:单行文章的 canonical 路径(构造唯一出口 postPath,§3 slug 红线)
  const itemPostId = view.postId === "" ? null : BigInt(view.postId);
  const post = itemPostId
    ? await prisma.post.findUnique({ where: { id: itemPostId }, select: { slug: true } })
    : null;
  const backPath = itemPostId && post ? postPath(itemPostId, post.slug) : "/";

  return (
    <div className="mx-auto w-full max-w-[var(--site-max-w)] px-4 py-10 sm:px-6">
      <CheckoutPanel
        orderNo={orderNo}
        postId={view.postId}
        amount={view.amount}
        title={view.title}
        status={view.status}
        backPath={backPath}
      />
    </div>
  );
}
