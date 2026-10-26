"""网关进程级运行时:签名服务 + 平台级 transport 单例的装配与 jar 热替换。

生命周期(lifespan 内 start/close)之外只有两条不变式:
- UA/指纹与签名绑定——transport 进程内只建一次,不随请求重建;
- jar 池以「身份集合」判定:调用方传来的 cookie 集合未变则保留冷却态,
  变了才整体替换(重启丢冷却态可接受,冷却只是退避加速)。
B 站与抖音各自独立单例(身份判等互不影响);wbi 键缓存进程级共享。
"""

from __future__ import annotations

from typing import Any

from app.adapters.bilibili.settings import BilibiliSettings
from app.adapters.bilibili.transport import BilibiliTransport
from app.adapters.bilibili.wbi import WbiKeyCache
from app.adapters.douyin.settings import DouyinSettings
from app.adapters.douyin.signer_client import (
    SignerRejectedError,
    SignerUnavailableError,
)
from app.adapters.douyin.transport import DouyinTransport
from app.log import get_logger
from app.signer.backend import BrowserUnavailableError, SignPageError
from app.signer.service import SignerService
from app.signer.settings import SignerSettings
from app.signer.slots import SlotManager

logger = get_logger(__name__)


class LocalSigner:
    """DouyinSignerProtocol 的进程内实现(签名服务就在本容器,免 HTTP 自呼)。

    backend 异常翻译成 transport 降级矩阵认识的两个签名异常:
    浏览器未就绪=基础设施(不冷却 jar),签名页失败=在线拒绝(同前)。
    """

    __slots__ = ("_service",)

    def __init__(self, service: SignerService) -> None:
        self._service = service

    async def sign(
        self, path: str, query: str, user_agent: str, cookies: str
    ) -> dict[str, str]:
        try:
            response = await self._service.sign(path, query, user_agent, cookies)
        except BrowserUnavailableError as exc:
            raise SignerUnavailableError(str(exc)) from exc
        except SignPageError as exc:
            raise SignerRejectedError(str(exc)) from exc
        return response.params


class GatewayRuntime:
    """签名服务与数据面 transport 的持有者;FastAPI lifespan 独占 start/close。"""

    def __init__(
        self,
        signer_settings: SignerSettings | None = None,
        douyin_settings: DouyinSettings | None = None,
        bilibili_settings: BilibiliSettings | None = None,
    ) -> None:
        self.signer_settings = signer_settings or SignerSettings()
        self.douyin_settings = douyin_settings or DouyinSettings()
        self.bilibili_settings = bilibili_settings or BilibiliSettings()
        self.service: SignerService | None = None
        self._transport: DouyinTransport | None = None
        self._jar_identity: frozenset[str] | None = None
        self._douyin_proxy: str | None = None
        self._bilibili_transport: BilibiliTransport | None = None
        self._bilibili_jar_identity: frozenset[str] | None = None
        self._bilibili_proxy: str | None = None
        self._wbi_cache = WbiKeyCache(self.bilibili_settings.wbi_cache_ttl_seconds)

    async def start(self) -> None:
        from app.signer.backend import PlaywrightBackend

        backend = PlaywrightBackend(self.signer_settings)
        self.service = SignerService(
            SlotManager(backend, self.signer_settings), self.signer_settings
        )
        await self.service.start()

    async def close(self) -> None:
        if self.service is not None:
            await self.service.close()

    def transport_for(self, cookies: list[str], proxy: str | None = None) -> DouyinTransport:
        """按请求 cookie 集合与出口代理取抖音 transport(单例;jar 身份变化才
        整体替换,代理变化仅热切会话工厂——冷却态保留,M33 批B)。"""
        identity = frozenset(cookies)
        if self._transport is None:
            self._transport = DouyinTransport(
                cookies=cookies,
                signer=LocalSigner(self.service) if self.service else None,
                settings=self.douyin_settings,
                proxy=proxy,
            )
            self._jar_identity = identity
            self._douyin_proxy = proxy
            logger.info(
                "gateway.transport_created",
                jars=len(cookies),
                ua=self._transport.user_agent,
                proxy=bool(proxy),
            )
        else:
            if identity != self._jar_identity:
                self._transport.replace_jars(cookies)
                self._jar_identity = identity
                logger.info("gateway.jars_replaced", jars=len(cookies))
            if proxy != self._douyin_proxy:
                self._transport.set_proxy(proxy)
                self._douyin_proxy = proxy
                logger.info("gateway.proxy_switched", platform="douyin", proxy=bool(proxy))
        return self._transport

    def transport_for_bilibili(
        self, cookies: list[str], proxy: str | None = None
    ) -> BilibiliTransport:
        """按请求 cookie 集合与出口代理取 B 站 transport(单例;身份判等独立
        于抖音;代理热切不重建,冷却态保留——M33 批B)。"""
        identity = frozenset(cookies)
        if self._bilibili_transport is None:
            self._bilibili_transport = BilibiliTransport(
                cookies=cookies,
                settings=self.bilibili_settings,
                proxy=proxy,
            )
            self._bilibili_jar_identity = identity
            self._bilibili_proxy = proxy
            logger.info("gateway.bilibili_transport_created", jars=len(cookies), proxy=bool(proxy))
        else:
            if identity != self._bilibili_jar_identity:
                self._bilibili_transport.replace_jars(cookies)
                self._bilibili_jar_identity = identity
                logger.info("gateway.bilibili_jars_replaced", jars=len(cookies))
            if proxy != self._bilibili_proxy:
                self._bilibili_transport.set_proxy(proxy)
                self._bilibili_proxy = proxy
                logger.info("gateway.proxy_switched", platform="bilibili", proxy=bool(proxy))
        return self._bilibili_transport

    def wbi_cache(self) -> WbiKeyCache:
        """B 站 wbi 键缓存(进程级单例,跨请求复用避免 nav 风暴)。"""
        return self._wbi_cache

    def jar_stats(self) -> dict[str, Any]:
        """顶层 jars_* 保留 = 抖音段(旧 TS zod 兼容);platforms 为 per-platform 全量。"""
        douyin = self._transport
        bilibili = self._bilibili_transport
        return {
            "jars_total": douyin.jars_total if douyin else 0,
            "jars_available": douyin.jars_available if douyin else 0,
            # 出口代理在用与否(布尔,永不透出 URL——M33 批B;网关零密钥,
            # 只反映最近一次请求携带的代理态)
            "egress_proxy": bool(self._douyin_proxy or self._bilibili_proxy),
            "platforms": {
                "douyin": {
                    "jars_total": douyin.jars_total if douyin else 0,
                    "jars_available": douyin.jars_available if douyin else 0,
                },
                "bilibili": {
                    "jars_total": bilibili.jars_total if bilibili else 0,
                    "jars_available": bilibili.jars_available if bilibili else 0,
                    "wbi_age_seconds": self._wbi_cache.age_seconds(),
                },
            },
        }
