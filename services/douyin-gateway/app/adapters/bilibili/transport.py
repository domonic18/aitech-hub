"""B 站 Web API 传输层:curl_cffi Chrome TLS 指纹 + Cookie jar 轮换 + 错误归因。

与抖音 transport 的三点差异:无浏览器签名门禁(wbi 由 api 层算好拼进
query,transport 纯传输);错误主流形态是 HTTP 200 + body code≠0(归因矩阵
``_interpret_body``);403/412 即风控墙(确定性,冷却 jar),429/5xx/空 body
按限速瞬时重试不冷却(与抖音同预算语义)。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Protocol, cast

from app.adapters.bilibili.exceptions import (
    AccountInvalidError,
    RiskControlError,
    StructureDriftError,
)
from app.adapters.bilibili.settings import BilibiliSettings
from app.adapters.common.jar_pool import CookieJar, JarPool
from app.log import get_logger

logger = get_logger(__name__)

#: HTTP 通道级风控:B 站风控墙常态是 412(偶发 403),确定性拒绝,冷却 jar
_RISK_CONTROL_STATUSES = {403, 412}

#: body code 归因矩阵(2026-10 社区实测):-352/-412/-116 风控;-404/-400 资源不存在
_RISK_CONTROL_CODES = {-352, -412, -116}
_ACCOUNT_CODES = {-404, -400}

# 2xx 非 JSON 的验证页特征(成功 JSON 内含同词属正常字段,只在 HTML 分支检查)
_RISK_CONTROL_BODY_MARKERS = ("captcha", "安全验证")

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)


class _AsyncHttpSession(Protocol):
    """curl_cffi AsyncSession 的最小鸭子类型(测试注入 fake 会话)。"""

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
    from curl_cffi.requests import AsyncSession

    session: Any = AsyncSession(impersonate="chrome")
    return cast("_AsyncHttpSession", session)


class BilibiliTransport:
    """有状态传输会话:多 jar 轮换,风控自动冷却;错误按 body code 归因。"""

    def __init__(
        self,
        cookies: list[str] | None = None,
        session_factory: Any | None = None,
        rate_limit_retry_delays: tuple[float, ...] | None = None,
        settings: BilibiliSettings | None = None,
        user_agent: str | None = None,
    ) -> None:
        settings = settings or BilibiliSettings()
        self._api_base = settings.api_base_url
        self._web_base = settings.web_base_url
        self._request_timeout = settings.request_timeout
        self._user_agent = user_agent or DEFAULT_USER_AGENT
        self._session_factory = session_factory or _default_session_factory
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
    def jars_total(self) -> int:
        return self._pool.jars_total

    def replace_jars(self, cookies: list[str]) -> None:
        """整体替换 jar 池(自举/手动导入后调用)。"""
        self._pool.replace_all(cookies)

    def _next_available_jar(self) -> CookieJar:
        jar = self._pool.next_available()
        if jar is None:
            raise RiskControlError(
                f"无可用 Cookie jar（共 {self._pool.jars_total} 份，全部冷却或未配置）"
            )
        return jar

    def _headers(self, jar: CookieJar) -> dict[str, str]:
        return {
            "User-Agent": self._user_agent,
            # B 站接口校验 Referer,缺省高频 412
            "Referer": f"{self._web_base}/",
            "Accept": "application/json, text/plain, */*",
            "Cookie": jar.cookie,
        }

    async def get_json(
        self, path: str, params: str, *, interpret_code: bool = True
    ) -> dict[str, Any]:
        """请求 GET 接口并按 body code 归因(限速瞬时失败重试,风控冷却 jar)。

        Args:
            path: 接口路径(如 ``/x/space/wbi/arc/search``)。
            params: 原始 query 串(调用方保证已 urlencode,wbi 已签)。
            interpret_code: False 跳过 code≠0 归因(nav 匿名返回 -101 但
                wbi_img 有效;资源类接口一律 True)。

        Raises:
            RiskControlError: 412/403 风控墙/-352/-412/-116/v_voucher 软风控(code=0)/限速与空 body 重试耗尽。
            AccountInvalidError: -404/-400。
            StructureDriftError: 未知 code 或 2xx 响应非 JSON。
        """
        last_body = ""
        for attempt in range(len(self._retry_delays) + 1):
            jar = self._next_available_jar()
            url = f"{self._api_base}{path}?{params}"

            async with self._session_factory() as session:
                response = await session.get(
                    url,
                    headers=self._headers(jar),
                    timeout=self._request_timeout,
                )

            status = getattr(response, "status_code", 0)
            text = getattr(response, "text", "") or ""
            if status < 200 or status >= 300:
                logger.warning(
                    "social_bilibili_request_rejected",
                    path=path,
                    status=status,
                    body=text[:160],
                )
            if status in _RISK_CONTROL_STATUSES:
                jar.cool_down()
                raise RiskControlError(f"HTTP {status}: {text[:200]}")
            if not 200 <= status < 300:
                # 429/5xx 及未知状态:瞬时型,不冷却,sleep 后换 jar 重发
                last_body = text
            elif not text.strip():
                # 200 空 body = 扣发/身份不一致,重发计入同一预算
                last_body = text
            else:
                data = self._parse_json(status, text, jar)
                if interpret_code:
                    self._interpret_body(data, jar, path=path)
                jar.revive()
                return data
            if attempt < len(self._retry_delays):
                await asyncio.sleep(self._retry_delays[attempt])
        raise RiskControlError(
            f"限速/扣发重试耗尽（{len(self._retry_delays) + 1} 次）: {last_body[:200]}"
        )

    def _parse_json(self, status: int, text: str, jar: CookieJar) -> dict[str, Any]:
        """解析 2xx body;验证页 HTML 判风控(jar 冷却),其余非 JSON 判结构漂移。"""
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            if any(marker in text for marker in _RISK_CONTROL_BODY_MARKERS):
                jar.cool_down()
                raise RiskControlError(f"HTTP {status}: {text[:200]}") from exc
            raise StructureDriftError(f"响应非 JSON（HTTP {status}）: {text[:200]}") from exc
        if not isinstance(data, dict):
            raise StructureDriftError(f"响应顶层不是对象（HTTP {status}）")
        return data

    def _interpret_body(
        self, data: dict[str, Any], jar: CookieJar, *, path: str = ""
    ) -> dict[str, Any]:
        """HTTP 200 body 归因矩阵:code≠0 按码分流;code=0 但 data 带 v_voucher
        (无 durl)是 B 站软风控挑战——不走非零码通道(2026-10-11 实测 playurl
        整段返回 code=0 + v_voucher),同按风控冷却 jar,防止突发期持续喂门。

        Args:
            data: 响应 body(顶层含 code)。
            jar: 本次请求使用的 jar(风控就地冷却)。
            path: 接口路径(仅日志上下文)。
        """
        code = data.get("code")
        if code == 0 or code is None:
            payload = data.get("data")
            if (
                isinstance(payload, dict)
                and payload.get("v_voucher")
                and not payload.get("durl")
            ):
                jar.cool_down()
                logger.warning(
                    "social_bilibili_voucher_gate", path=path, body=str(data)[:200]
                )
                raise RiskControlError(f"code=0 v_voucher 软风控: {str(data)[:160]}")
            return data
        message = str(data.get("message") or "")
        if code in _RISK_CONTROL_CODES:
            jar.cool_down()
            raise RiskControlError(f"code={code} {message}")
        if code in _ACCOUNT_CODES:
            raise AccountInvalidError(f"code={code} {message}")
        raise StructureDriftError(f"未知 code={code} {message}: {str(data)[:160]}")

    async def resolve_redirect(self, url: str) -> str:
        """跟随一次 302 取最终地址(b23.tv 短链展开用,不带 Cookie 不签名)。"""
        async with self._session_factory() as session:
            response = await session.get(
                url,
                headers={"User-Agent": self._user_agent},
                timeout=self._request_timeout,
                allow_redirects=False,
            )
        location = response.headers.get("Location") if hasattr(response, "headers") else None
        if not location:
            raise StructureDriftError(f"短链未返回跳转目标: {url}")
        return str(location)
