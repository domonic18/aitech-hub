/**
 * 请求辅助(arch/05-services §3):客户端 IP 提取。
 * nginx 反代形态,x-forwarded-for 首跳为真实客户端;无代理头回退 x-real-ip。
 */

export function clientIp(req: Pick<Request, "headers">): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "";
}
