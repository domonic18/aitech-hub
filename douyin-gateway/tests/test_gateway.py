"""网关 wire 层测试:sec_uid 提取、请求校验边界、jar 池身份热替换。"""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.adapters.douyin.signing import generate_fingerprint
from app.adapters.douyin.transport import DouyinTransport
from app.gateway import PostsRequest, ResolveRequest, extract_sec_uid
from app.gateway_runtime import GatewayRuntime
from app.signer.settings import SignerSettings

pytestmark = pytest.mark.unit


def test_extract_sec_uid_from_various_inputs() -> None:
    sec = "MS4wLjABAAAA1234567890abcdefghij"
    assert extract_sec_uid(f"https://www.douyin.com/user/{sec}?a=1") == sec
    assert extract_sec_uid(sec) == sec
    assert extract_sec_uid("看看这个 https://v.douyin.com/iabcDEF/ 太强了") is None


def test_posts_request_rejects_short_sec_uid() -> None:
    with pytest.raises(ValidationError):
        PostsRequest(sec_uid="short")


def test_posts_request_caps_pages() -> None:
    with pytest.raises(ValidationError):
        PostsRequest(sec_uid="MS4wLjABAAAA1234567890abcdefghij", max_pages=10)


def test_resolve_request_min_length() -> None:
    with pytest.raises(ValidationError):
        ResolveRequest(url="v.co")


class _RecordingRuntime(GatewayRuntime):
    """transport_for 身份替换语义的观测桩(不触网)。"""

    def __init__(self) -> None:
        super().__init__(signer_settings=SignerSettings(log_level="warning"))
        self.replacements = 0
        self.transport = _StubTransport()

    def transport_for(self, cookies: list[str]) -> Any:
        identity = frozenset(cookies)
        if identity != self._jar_identity:
            self.replacements += 1
            self._jar_identity = identity
        return self.transport


class _StubTransport:
    jars_total = 2
    jars_available = 2
    user_agent = "stub"


def test_runtime_keeps_cooldown_state_when_identity_unchanged() -> None:
    runtime = _RecordingRuntime()
    cookies = ["ttwid=a", "ttwid=b"]
    runtime.transport_for(cookies)
    runtime.transport_for(cookies)
    assert runtime.replacements == 1
    runtime.transport_for(["ttwid=a"])
    assert runtime.replacements == 2


def _client() -> TestClient:
    from app.gateway import create_app

    return TestClient(create_app(SignerSettings(log_level="warning")))


def test_health_always_answers_200() -> None:
    with _client() as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] in {"ok", "starting", "unavailable"}
        assert "jars_total" in body


def test_sign_rejects_bad_path_without_touching_browser() -> None:
    with _client() as client:
        resp = client.post(
            "/sign",
            json={
                "path": "/evil/v1/",
                "query": "a=1",
                "user_agent": "Mozilla/5.0",
                "cookies": "ttwid=abc",
            },
        )
        assert resp.status_code == 422


def test_transport_settings_env_contract() -> None:
    """settings 注入后 transport 取值映射正确(字段改名防回归)。"""
    from app.adapters.douyin.settings import DouyinSettings

    settings = DouyinSettings(
        base_url="https://example.com",
        request_timeout=3.0,
        jar_cooldown_base_seconds=5,
        jar_cooldown_max_seconds=9,
        rate_limit_retry_delays=(0.0,),
    )
    transport = DouyinTransport(
        cookies=["ttwid=abc"],
        fingerprint=generate_fingerprint(),
        session_factory=lambda: None,
        rate_limit_retry_delays=(0.0,),
        settings=settings,
    )
    assert transport._base_url == "https://example.com"
    assert transport._request_timeout == 3.0
    assert transport._cooldown_base == 5
    assert transport._cooldown_max == 9
