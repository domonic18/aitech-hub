"""出站通道公共层(M33 批B):网络/代理层故障归一 + 可选代理会话工厂。

EgressError ≠ 风控:请求未到达对端(代理断连/DNS 失败/超时),不冷却任何
jar——网关映射 503(基建错误语义,Node 侧 GatewayUnavailable 顺延不计失败,
与 BrowserUnavailableError 同款);风控/限速是对端有响应后的归因,不走这里。
"""

from __future__ import annotations

from typing import Any, Callable, Protocol, cast


class EgressError(Exception):
    """出站请求失败(代理断连/DNS/超时等网络层故障),尚未拿到对端响应。"""


class _AsyncHttpSession(Protocol):
    def get(self, url: str, **kwargs: Any) -> Any: ...

    def __aenter__(self) -> "_AsyncHttpSession": ...

    async def __aexit__(self, *args: Any) -> None: ...


def make_session_factory(proxy: str | None = None) -> Callable[[], _AsyncHttpSession]:
    """curl_cffi Chrome 指纹会话工厂(proxy=None 直连;家宽出口即 http(s)://
    或 socks5:// URL,随请求携带,网关零密钥——不落盘不打日志)。"""

    def factory() -> _AsyncHttpSession:
        from curl_cffi.requests import AsyncSession

        session: Any = AsyncSession(impersonate="chrome", proxy=proxy)
        return cast("_AsyncHttpSession", session)

    return factory


async def egress_get(session: _AsyncHttpSession, url: str, **kwargs: Any) -> Any:
    """GET 并把网络层故障(含代理断连)翻译为 EgressError。

    curl_cffi 异常类型随版本漂移,按 Exception 兜底(asyncio.CancelledError
    是 BaseException 子类,不会被吞);对端有响应的失败(4xx/5xx/风控墙)
    不走这里,仍由各 transport 的归因矩阵处理。
    """
    try:
        return await session.get(url, **kwargs)
    except Exception as exc:
        raise EgressError(f"出站请求失败(网络/代理): {exc}") from exc
