/**
 * 网关查询错误分类(M21 批④ 补,2026-10-29 对账噪音收口):查询失败分两族——
 *  - 传输层(网络/超时/非 200,postForm 抛出):可重试,sweep 按失败计数退避告警;
 *  - 业务层(HTTP 200 且 errcode≠0,网关明确作答):同参同答,重试无意义。
 *
 * 业务层里「单不存在」是单笔终态:本地已过期即应关单收口,不能当抖动无限重试
 * (线上 id=22 孤儿单因此连发 pay.reconcile_error,每小时计数清零后升 error)。
 * 其余业务错误(签名错、appid 错等)是全局配置问题,必须继续报错而非关单——
 * 两族的判别就是本类存在的唯一理由,勿在调用侧按 errmsg 字符串各自重判。
 */
export class GatewayQueryError extends Error {
  constructor(
    /** 网关原始 errcode(日志原样带出,措辞漂移时可按此收紧判别) */
    readonly code: string,
    message: string,
    /** 网关明确答「该订单不存在」(单笔终态,非全局问题) */
    readonly orderNotFound = false,
  ) {
    super(message);
    this.name = "GatewayQueryError";
  }
}
