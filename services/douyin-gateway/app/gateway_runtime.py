"""网关进程级运行时:签名服务 + 平台级 transport 单例的装配与 jar 热替换。

生命周期(lifespan 内 start/close)之外只有两条不变式:
- UA/指纹与签名绑定——transport 进程内只建一次,不随请求重建;
- jar 池以「身份集合」判定:调用方传来的 cookie 集合未变则保留冷却态,
  变了才整体替换(重启丢冷却态可接受,冷却只是退避加速)。
"""

from __future__ import annotations

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
    ) -> None:
        self.signer_settings = signer_settings or SignerSettings()
        self.douyin_settings = douyin_settings or DouyinSettings()
        self.service: SignerService | None = None
        self._transport: DouyinTransport | None = None
        self._jar_identity: frozenset[str] | None = None

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

    def transport_for(self, cookies: list[str]) -> DouyinTransport:
        """按请求 cookie 集合取 transport(单例;jar 池身份变化才替换)。"""
        identity = frozenset(cookies)
        if self._transport is None:
            self._transport = DouyinTransport(
                cookies=cookies,
                signer=LocalSigner(self.service) if self.service else None,
                settings=self.douyin_settings,
            )
            self._jar_identity = identity
            logger.info(
                "gateway.transport_created",
                jars=len(cookies),
                ua=self._transport.user_agent,
            )
        elif identity != self._jar_identity:
            self._transport.replace_jars(cookies)
            self._jar_identity = identity
            logger.info("gateway.jars_replaced", jars=len(cookies))
        return self._transport

    def jar_stats(self) -> dict[str, int]:
        if self._transport is None:
            return {"jars_total": 0, "jars_available": 0}
        return {
            "jars_total": self._transport.jars_total,
            "jars_available": self._transport.jars_available,
        }
