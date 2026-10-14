"""抖音 Web API 传输层：curl_cffi Chrome TLS 指纹 + Cookie jar 轮换 + 签名。

东财同款 WAF 生态按 TLS 指纹拦截，必须走 curl_cffi 的 Chrome 指纹
（先例见 collector/spiders/eastmoney_research_report.py）。
签名双轨：signer（页面 SDK sidecar）在线用其参数原样透传，失败/未配置
回退本地 a_bogus（灰度期端点仍可用）。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Protocol
from urllib.parse import urlencode

from app.adapters.common.egress import egress_get, make_session_factory
from app.adapters.common.jar_pool import CookieJar, JarPool
from app.adapters.douyin.exceptions import (
    NoJarAvailableError,
    RiskControlError,
    SignatureError,
    StructureDriftError,
)
from app.adapters.douyin.settings import DouyinSettings
from app.adapters.douyin.signer_client import (
    DouyinSignerProtocol,
    SignerRejectedError,
    SignerUnavailableError,
)
from app.adapters.douyin.signing import (
    DEFAULT_USER_AGENT,
    ABogus,
    generate_fingerprint,
)
from app.log import get_logger

logger = get_logger(__name__)

# 命中即按风控处置的 HTTP 状态；正文特征只对 2xx 非 JSON（验证页 HTML）检查
_RISK_CONTROL_STATUSES = {403, 429}
_RISK_CONTROL_BODY_MARKERS = ("captcha", "verify", "安全验证")

# Argus 门禁确定性拒绝（2026-09-14 起灰度覆盖作品端点）：重试只会加速验证码
_ARGUS_REJECTION_MARKER = "ArgusSecurityPlugin"


class _AsyncHttpSession(Protocol):
    """curl_cffi AsyncSession 的最小鸭子类型（测试注入 fake 会话）。"""

    async def get(
        self,
        url: str,
        *,
        headers: dict[str, str],
        timeout: float,
        allow_redirects: bool = True,
    ) -> Any: ...

    async def __aenter__(self) -> _AsyncHttpSession: ...

    async def __aexit__(self, *args: Any) -> None: ...


def _default_session_factory() -> _AsyncHttpSession:
    """直连缺省工厂(M33 批B 起代理感知缺省见 __init__/set_proxy)。"""
    return make_session_factory()


class DouyinTransport:
    """有状态传输会话：UA/指纹与签名绑定，多 jar 轮换，命中风控自动冷却。"""

    def __init__(
        self,
        cookies: list[str] | None = None,
        user_agent: str | None = None,
        fingerprint: str | None = None,
        session_factory: Any | None = None,
        signer: DouyinSignerProtocol | None = None,
        rate_limit_retry_delays: tuple[float, ...] | None = None,
        settings: DouyinSettings | None = None,
        proxy: str | None = None,
    ) -> None:
        settings = settings or DouyinSettings()
        self._base_url = settings.base_url
        self._request_timeout = settings.request_timeout
        self._user_agent = user_agent or DEFAULT_USER_AGENT
        self._fingerprint = fingerprint or generate_fingerprint()
        self._abogus = ABogus(
            user_agent=self._user_agent, fp=self._fingerprint, options=[0, 1, 8]
        )
        self._proxy = proxy
        self._injected_factory = session_factory is not None
        self._session_factory = session_factory or make_session_factory(proxy)
        self._signer = signer
        # 限速型 403/429 与 200 空 body 是瞬时的（douyin-downloader 实测同
        # cookie 秒级恢复）：冷却会杀死秒级重试，sleep 后换 jar 重签重发
        self._retry_delays = (
            rate_limit_retry_delays
            if rate_limit_retry_delays is not None
            else settings.rate_limit_retry_delays
        )
        self._pool = JarPool(
            cookies or [],
            cooldown_base_seconds=settings.jar_cooldown_base_seconds,
            cooldown_max_seconds=settings.jar_cooldown_max_seconds,
        )

    @property
    def user_agent(self) -> str:
        return self._user_agent

    @property
    def jars_available(self) -> int:
        return self._pool.jars_available

    @property
    def proxy(self) -> str | None:
        """当前出站代理(观测用;值本身不进日志)。"""
        return self._proxy

    def set_proxy(self, proxy: str | None) -> None:
        """热切换出站代理(M33 批B):仅换会话工厂,jar 池与冷却态原样保留。
        注入 session_factory 的场景(测试)代理不生效,由桩自证。"""
        self._proxy = proxy
        if not self._injected_factory:
            self._session_factory = make_session_factory(proxy)

    @property
    def jars_total(self) -> int:
        return self._pool.jars_total

    def replace_jars(self, cookies: list[str]) -> None:
        """整体替换 jar 池（自举/手动导入后调用）。"""
        self._pool.replace_all(cookies)

    def _next_available_jar(self) -> CookieJar:
        jar = self._pool.next_available()
        if jar is None:
            # 池耗尽独立归因(≠真风控):请求未发出,不冷却不喂门,Node 侧
            # 采集免疫顺延;类名即网关 error 字段
            raise NoJarAvailableError(
                f"无可用 Cookie jar（共 {self._pool.jars_total} 份，全部冷却或未配置）"
            )
        return jar

    def _headers(self, jar: CookieJar) -> dict[str, str]:
        return {
            "User-Agent": self._user_agent,
            "Referer": f"{self._base_url}/",
            "Accept": "application/json, text/plain, */*",
            "Cookie": jar.cookie,
        }

    async def get_json(self, path: str, params: str) -> dict[str, Any]:
        """签名并请求 GET 接口（限速瞬时失败重签重试，Argus 门禁立即终态）。

        Args:
            path: 接口路径（如 ``/aweme/v1/web/aweme/post/``）。
            params: 原始 query 串（调用方保证已 urlencode）。

        Returns:
            服务端 JSON 响应。

        Raises:
            RiskControlError: Argus 拒绝/captcha/5xx/限速与空 body 重试耗尽。
            SignatureError: 400（签名被拒）。
            StructureDriftError: 2xx 但响应非 JSON。
        """
        last_body = ""
        for attempt in range(len(self._retry_delays) + 1):
            jar = self._next_available_jar()
            url = f"{self._base_url}{path}?{await self._sign(path, params, jar)}"

            async with self._session_factory() as session:
                response = await egress_get(
                    session,
                    url,
                    headers=self._headers(jar),
                    timeout=self._request_timeout,
                )

            status = getattr(response, "status_code", 0)
            text = getattr(response, "text", "") or ""
            if status < 200 or status >= 300:
                # 通道级失败的现场记录（url/status/响应头），便于归因风控形态
                logger.warning(
                    "social_douyin_request_rejected",
                    path=path,
                    status=status,
                    body=text[:160],
                )
            if status == 400:
                raise SignatureError(f"HTTP 400: {text[:200]}")
            if status not in _RISK_CONTROL_STATUSES and not 200 <= status < 300:
                jar.cool_down()
                raise RiskControlError(f"HTTP {status}: {text[:200]}")
            if status in _RISK_CONTROL_STATUSES:
                if _ARGUS_REJECTION_MARKER in text:
                    jar.cool_down()
                    raise RiskControlError(f"HTTP {status}: {text[:200]}")
                # 限速型（body 空或无关）：不冷却，换 jar 重签重发
                last_body = text
            elif not text.strip():
                # 200 空 body = 反爬扣发/身份不一致，重签重发（计入同一预算）
                last_body = text
            else:
                data = self._parse_json(status, text, jar)
                jar.revive()
                return data
            if attempt < len(self._retry_delays):
                await asyncio.sleep(self._retry_delays[attempt])
        raise RiskControlError(
            f"限速/扣发重试耗尽（{len(self._retry_delays) + 1} 次）: {last_body[:200]}"
        )

    def _parse_json(self, status: int, text: str, jar: CookieJar) -> dict[str, Any]:
        """解析 2xx body；验证页 HTML 判风控（jar 冷却），其余非 JSON 判结构漂移。"""
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            # 2xx 非 JSON 才可能是风控验证页；成功 JSON 内含 verify 等词属正常字段
            # （2026-09-16 走查：aweme 的 custom_verify 撞词致误判 FAILED）
            if any(marker in text for marker in _RISK_CONTROL_BODY_MARKERS):
                jar.cool_down()
                raise RiskControlError(f"HTTP {status}: {text[:200]}") from exc
            raise StructureDriftError(f"响应非 JSON（HTTP {status}）: {text[:200]}") from exc
        if not isinstance(data, dict):
            raise StructureDriftError(f"响应顶层不是对象（HTTP {status}）")
        return data

    async def _sign(self, path: str, params: str, jar: _CookieJar) -> str:
        """产出最终 query：signer 在线用页面 SDK 参数（原样追加），否则本地 a_bogus。"""
        if self._signer is None:
            return self._abogus.generate_abogus(params)[0]
        try:
            sdk_params = await self._signer.sign(path, params, self._user_agent, jar.cookie)
        except (SignerUnavailableError, SignerRejectedError) as exc:
            # 基础设施问题 ≠ 风控：不冷却 jar，回退本地签名（灰度期端点仍可用）
            logger.warning("social_douyin_signer_fallback", error=str(exc))
            return self._abogus.generate_abogus(params)[0]
        # SDK 参数原样追加，绝不补任何未签参数（msToken 事故：补参 = Sign Invalid）
        return f"{params}&{urlencode(sdk_params)}"

    async def resolve_redirect(self, url: str) -> str:
        """跟随一次 302 取最终地址（分享短链展开用，不带 Cookie 不签名）。"""
        async with self._session_factory() as session:
            response = await egress_get(
                session,
                url,
                headers={"User-Agent": self._user_agent},
                timeout=self._request_timeout,
                allow_redirects=False,
            )
        location = response.headers.get("Location") if hasattr(response, "headers") else None
        if not location:
            raise StructureDriftError(f"短链未返回跳转目标: {url}")
        return str(location)
