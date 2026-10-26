"""B 站适配层归因异常(与抖音同构;类名即网关 error 字段,Node 侧零感知)。

处置约定与抖音一致:
- StructureDriftError:页面结构巨变,直接 FAILED 告警跟版;
- RiskControlError:风控(-352/-412/-116/412/403),jar 冷却换 jar 退避重试;
- AccountInvalidError:UP 主/资源不存在(-404/-400),记 last_error 不停用账号。
"""


class BilibiliAdapterError(Exception):
    """适配层异常基类。"""


class RiskControlError(BilibiliAdapterError):
    """命中风控(body code -352/-412/-116 或 HTTP 412/403),可冷却后重试。"""


class NoJarAvailableError(BilibiliAdapterError):
    """Cookie 池耗尽(全部冷却或未配置),尚未发出请求——不是真风控:
    不冷却任何 jar,池恢复(冷却到期/导入新 jar)即自愈。与 RiskControlError
    拆分(2026-10-14 生产实证:单视频 voucher 门冷却唯一 jar,采集侧把
    「无可用 jar」当风控计入连败,9 博主连带烧死)。"""


class AccountInvalidError(BilibiliAdapterError):
    """UP 主不存在、注销或资源已删除。"""


class StructureDriftError(BilibiliAdapterError):
    """响应结构与预期不符(接口契约变化)。"""
