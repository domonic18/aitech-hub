"""wbi 签名测试:金向量(社区文档公开示例)+ 清洗规则 + TTL 缓存(fake clock)。"""

import pytest

from app.adapters.bilibili.exceptions import RiskControlError, StructureDriftError
from app.adapters.bilibili.wbi import (
    MIXIN_KEY_ENC_TAB,
    WbiKeyCache,
    derive_mixin_key,
    sign_wbi_params,
    wbi_key_from_url,
)

pytestmark = pytest.mark.unit

# bilibili-API-collect wbi.md 公开示例键(mixin 结果可与文档互证)
IMG_KEY = "7cd084941338484aae1ad9425b84077c"
SUB_KEY = "4932caff0ff746eab6f01bf08b70ac45"
MIXIN_KEY = "ea1db124af3c7062474693fa704f4ff8"


class TestGoldenVectors:
    def test_mixin_table_is_64_entries(self) -> None:
        assert len(MIXIN_KEY_ENC_TAB) == 64

    def test_derive_mixin_key(self) -> None:
        assert derive_mixin_key(IMG_KEY, SUB_KEY) == MIXIN_KEY

    def test_sign_params_golden(self) -> None:
        """固定 now 的完整签名向量(算法任何漂移都会使 w_rid 变化)。"""
        signed = sign_wbi_params(
            {"foo": "one!Value", "bar": "two", "baz": 3},
            MIXIN_KEY,
            now=1702204800,
        )
        assert signed == {
            "bar": "two",
            "baz": "3",
            "foo": "oneValue",
            "wts": "1702204800",
            "w_rid": "9247a26c7b81cae72c53f6574a698e64",
        }

    def test_key_from_url(self) -> None:
        assert (
            wbi_key_from_url(
                "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png"
            )
            == IMG_KEY
        )


class TestSignParamsRules:
    def test_strips_special_chars_from_values(self) -> None:
        signed = sign_wbi_params({"k": "a!'()*b"}, MIXIN_KEY, now=1)
        assert signed["k"] == "ab"

    def test_drops_existing_rid_and_ts(self) -> None:
        """重签防叠参:传入的 w_rid/wts 被剔除重算。"""
        signed = sign_wbi_params(
            {"k": "v", "w_rid": "OLD", "wts": "111"}, MIXIN_KEY, now=222
        )
        assert signed["wts"] == "222"
        assert signed["w_rid"] != "OLD"
        assert len(signed["w_rid"]) == 32

    def test_signs_are_deterministic_per_now(self) -> None:
        a = sign_wbi_params({"x": "1"}, MIXIN_KEY, now=5)
        b = sign_wbi_params({"x": "1"}, MIXIN_KEY, now=5)
        assert a == b


class _FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class TestWbiKeyCache:
    async def test_fetches_once_within_ttl(self) -> None:
        clock = _FakeClock()
        cache = WbiKeyCache(43200, time_fn=clock)
        calls = []

        async def fetch() -> str:
            calls.append(1)
            return MIXIN_KEY

        assert await cache.get(fetch) == MIXIN_KEY
        clock.now += 1000
        assert await cache.get(fetch) == MIXIN_KEY
        assert len(calls) == 1
        assert cache.age_seconds() == 1000

    async def test_expired_triggers_refetch(self) -> None:
        clock = _FakeClock()
        cache = WbiKeyCache(100, time_fn=clock)
        keys = iter(["first", "second"])

        async def fetch() -> str:
            return next(keys)

        assert await cache.get(fetch) == "first"
        clock.now += 101
        assert await cache.get(fetch) == "second"

    async def test_refresh_failure_falls_back_to_stale(self) -> None:
        clock = _FakeClock()
        cache = WbiKeyCache(100, time_fn=clock)

        async def ok() -> str:
            return MIXIN_KEY

        async def fail() -> str:
            raise RiskControlError("nav 被风控")

        assert await cache.get(ok) == MIXIN_KEY
        clock.now += 101
        assert await cache.get(fail) == MIXIN_KEY  # 陈旧兜底
        # 兜底推进了 fetched_at:故障期每 TTL 至多重试一次
        clock.now += 50
        assert await cache.get(fail) == MIXIN_KEY

    async def test_age_none_before_first_fetch(self) -> None:
        cache = WbiKeyCache(100, time_fn=_FakeClock())
        assert cache.age_seconds() is None

    async def test_first_fetch_failure_propagates(self) -> None:
        cache = WbiKeyCache(100, time_fn=_FakeClock())

        async def fail() -> str:
            raise StructureDriftError("nav 结构漂移")

        with pytest.raises(StructureDriftError):
            await cache.get(fail)
