"""Cookie 纯 helper 与首页自举测试(自上游 test_douyin_cookies.py 裁剪——
Fernet 加密落库段归 Node 编排层,网关只经手明文 jar)。"""

from typing import Any

import pytest

from app.adapters.douyin.cookies import (
    bootstrap_cookies,
    is_cookie_usable,
    merge_cookies,
    parse_set_cookie_header,
)

pytestmark = pytest.mark.unit


def test_parse_set_cookie_header_takes_first_segment() -> None:
    assert parse_set_cookie_header("ttwid=abc; Path=/; Max-Age=3600") == {"ttwid": "abc"}


def test_parse_set_cookie_header_garbage_returns_empty() -> None:
    assert parse_set_cookie_header("invalid-header") == {}


def test_merge_cookies_additions_override_same_name() -> None:
    merged = merge_cookies("a=1; b=2", {"b": "3", "c": "4"})
    assert merged == "a=1; b=3; c=4"


def test_is_cookie_usable_requires_ttwid() -> None:
    assert is_cookie_usable("ttwid=abc; sessionid=x")
    assert not is_cookie_usable("sessionid=x")
    assert not is_cookie_usable(None)


class _FakeHeaders:
    def __init__(self, items: list[tuple[str, str]]) -> None:
        self._items = items

    def items(self) -> list[tuple[str, str]]:
        return self._items


class _FakeBootstrapSession:
    def __init__(self, headers: list[tuple[str, str]]) -> None:
        self._headers = headers

    async def get(self, url: str, **kwargs: Any) -> Any:
        return type("Resp", (), {"headers": _FakeHeaders(self._headers)})()

    async def __aenter__(self) -> "_FakeBootstrapSession":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None


@pytest.mark.asyncio
async def test_bootstrap_cookies_collects_set_cookie() -> None:
    session = _FakeBootstrapSession(
        [
            ("set-cookie", "ttwid=abc; Path=/"),
            ("set-cookie", "msToken=xyz; Path=/"),
            ("other", "ignored"),
        ]
    )
    cookie = await bootstrap_cookies(session_factory=lambda: session)
    assert "ttwid=abc" in cookie
    assert "msToken=xyz" in cookie


@pytest.mark.asyncio
async def test_bootstrap_cookies_without_ttwid_raises() -> None:
    session = _FakeBootstrapSession([("set-cookie", "staticcad=1; Path=/")])
    from app.adapters.douyin.exceptions import RiskControlError

    with pytest.raises(RiskControlError):
        await bootstrap_cookies(session_factory=lambda: session)
