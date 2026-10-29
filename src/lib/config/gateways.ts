/**
 * 网关地址出口(M56 review P2-6):douyin-gateway base 唯一出处——
 * env DOUYIN_GATEWAY_URL 优先,缺省容器网内地址;此前三处逐字重复。
 */
export function douyinGatewayBase(): string {
  return process.env.DOUYIN_GATEWAY_URL ?? "http://douyin-gateway:8010";
}
