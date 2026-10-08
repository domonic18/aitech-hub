"""契约黄金样本对拍:TestClient 实跑端点(桩 runtime/api,真实 pydantic
序列化路径),响应形状与 contract/*.json 逐字段对齐。TS 侧 Zod 镜像
(src/lib/telegram/adapters/video/gateway-contract.ts)消费同一批 fixture——
网关改形状 → 本文件红;重生成 fixture → TS vitest 红逼同步。
/sign 不入契约(仅网关内部消费)。边界值口径见 test_gateway.py。

用法:pytest tests/test_contract_fixtures.py(比对,CI gateway job)
     .venv/bin/python tests/test_contract_fixtures.py --bless(契约变更时重生成)
"""

from __future__ import annotations

import json
import sys
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # 直跑 --bless 补 rootdir

from fastapi.testclient import TestClient

from app.adapters.douyin.api import DouyinPostsPage, DouyinProfile, DouyinVideo
from app.adapters.douyin.exceptions import AccountInvalidError, RiskControlError
from app.signer.settings import SignerSettings

CONTRACT_DIR = Path(__file__).resolve().parent.parent / "contract"

SEC = "MS4wLjABAAAA1234567890abcdefghij"
# 命中桩归因:profile 拉这个 sec_uid 抛 AccountInvalidError,posts 抛 RiskControlError
SEC_ACCOUNT_INVALID = "MS4wLjABAAAAdead000000000000000000000"
SEC_RISK_CONTROL = "MS4wLjABAAAArisk0000000000000000000000"


class _StubTransport:
    jars_total = 3
    jars_available = 2
    user_agent = "stub"


class _FakeRuntime:
    """create_app 注入桩:transport 固定、service=None(503 分支)、零触网。"""

    service = None
    signer_settings = SignerSettings(log_level="warning")

    def __init__(self) -> None:
        self.transport = _StubTransport()

    async def start(self) -> None:
        return None

    async def close(self) -> None:
        return None

    def transport_for(self, _cookies: list[str]) -> Any:
        return self.transport

    def jar_stats(self) -> dict[str, int]:
        return {"jars_total": 3, "jars_available": 2}


class _StubApi:
    """DouyinWebApi 替身:返回归一化 dataclass(走真实 VideoOut 序列化)。"""

    def __init__(self, _transport: Any) -> None:
        return None

    async def get_user_posts(self, sec_uid: str, max_cursor: int = 0) -> DouyinPostsPage:
        if sec_uid == SEC_RISK_CONTROL:
            raise RiskControlError("命中频控 429")
        video = DouyinVideo(
            video_id="7301234567890123456",
            caption="一分钟掌握今日 AI 大事\n#AI #大模型",
            topic_tags=["AI", "大模型"],
            cover_url="https://p3-sign.douyinpic.com/cover.jpeg",
            play_url="https://v.douyinvod.com/preview.mp4",
            duration_seconds=51,
            published_at=datetime(2026, 10, 3, 23, 5, 0, tzinfo=UTC),
            digg_count=116,
            comment_count=12,
            share_count=3,
        )
        return DouyinPostsPage(videos=[video], has_more=True, max_cursor=7301234567890123456)

    async def get_user_profile(self, sec_uid: str) -> DouyinProfile:
        if sec_uid == SEC_ACCOUNT_INVALID:
            raise AccountInvalidError(f"sec_uid={sec_uid} 主页为空或转私密")
        return DouyinProfile(
            sec_uid=sec_uid,
            nickname="AI 前沿",
            avatar_url="https://p3-sign.douyinpic.com/avatar.jpg",
        )

    async def expand_short_link(self, _url: str) -> str:
        return f"https://www.douyin.com/user/{SEC}"


@contextmanager
def _patched_gateway() -> Iterator[None]:
    """换桩须覆盖 create_app/lifespan/请求全程(restore 早于请求即穿帮)。"""
    import app.gateway as gw

    saved = (gw.GatewayRuntime, gw.DouyinWebApi)
    gw.GatewayRuntime = lambda signer_settings=None: _FakeRuntime()  # type: ignore[assignment]
    gw.DouyinWebApi = _StubApi  # type: ignore[assignment]
    try:
        yield
    finally:
        gw.GatewayRuntime, gw.DouyinWebApi = saved


def _build_client() -> TestClient:
    """须在 _patched_gateway() 内构造(TestClient __enter__ 才跑 lifespan)。"""
    from app.gateway import create_app

    return TestClient(create_app(SignerSettings(log_level="warning")))


def collect_samples() -> dict[str, dict[str, Any]]:
    """实跑端点采集契约样本:{status, body}。"""
    out: dict[str, dict[str, Any]] = {}

    def record(name: str, resp: Any) -> None:
        out[name] = {"status": resp.status_code, "body": resp.json()}

    with _patched_gateway(), _build_client() as client:
        record(
            "posts.success",
            client.post("/posts", json={"sec_uid": SEC, "cookies": ["ttwid=a"], "max_pages": 1}),
        )
        record("posts.risk_control", client.post("/posts", json={"sec_uid": SEC_RISK_CONTROL}))
        record(
            "profile.success",
            client.post("/profile", json={"sec_uid": SEC, "cookies": ["ttwid=a"]}),
        )
        record("profile.account_invalid", client.post("/profile", json={"sec_uid": SEC_ACCOUNT_INVALID}))
        record("resolve.success", client.post("/resolve", json={"url": f"https://www.douyin.com/user/{SEC}"}))
        record("health.success", client.get("/health"))
        record("error.validation", client.post("/posts", json={"sec_uid": "short"}))
    return out


def shape(value: Any) -> Any:
    """递归形状:dict→{key: shape},list→[首元素形状],标量→类型名。"""
    if isinstance(value, dict):
        return {k: shape(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    return type(value).__name__


def test_contract_matches_golden_fixtures() -> None:
    samples = collect_samples()
    mismatches: list[str] = []
    for name, sample in samples.items():
        fixture_path = CONTRACT_DIR / f"{name}.json"
        if not fixture_path.exists():
            mismatches.append(f"{name}: fixture 缺失(跑 --bless 重生成)")
            continue
        golden = json.loads(fixture_path.read_text(encoding="utf-8"))
        if sample["status"] != golden["status"]:
            mismatches.append(f"{name}: status {sample['status']} != {golden['status']}")
        if shape(sample["body"]) != shape(golden["body"]):
            mismatches.append(
                f"{name}: 形状漂移\n  actual={json.dumps(shape(sample['body']), ensure_ascii=False)}\n"
                f"  golden={json.dumps(shape(golden['body']), ensure_ascii=False)}"
            )
    assert not mismatches, "契约漂移:\n" + "\n".join(mismatches)


if __name__ == "__main__":
    if "--bless" in sys.argv:
        CONTRACT_DIR.mkdir(exist_ok=True)
        for name, sample in collect_samples().items():
            path = CONTRACT_DIR / f"{name}.json"
            path.write_text(
                json.dumps(sample, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            print(f"blessed {path.name}")
    else:
        raise SystemExit("传 --bless 重生成黄金样本;比对请用 pytest")
