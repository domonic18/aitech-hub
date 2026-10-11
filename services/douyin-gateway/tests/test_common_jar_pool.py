"""公共 jar 池测试:轮换/冷却/复活/替换语义(抖音与 B 站共用)。"""

from datetime import datetime, timezone

import pytest

from app.adapters.common.jar_pool import CookieJar, JarPool

pytestmark = pytest.mark.unit


def make_pool(cookies: list[str], *, base: int = 300, max_seconds: int = 7200) -> JarPool:
    return JarPool(
        cookies, cooldown_base_seconds=base, cooldown_max_seconds=max_seconds
    )


class TestCookieJar:
    def test_cool_down_exponential_with_cap(self) -> None:
        jar = CookieJar("c", cooldown_base_seconds=10, cooldown_max_seconds=100)
        jar.cool_down()
        assert jar.strikes == 1
        jar.cool_down()
        assert jar.strikes == 2
        for _ in range(6):
            jar.cool_down()  # 10*2^7=1280 > 100,封顶 100
        assert jar.strikes == 8
        assert jar.cool_until is not None

    def test_revive_resets(self) -> None:
        jar = CookieJar("c", cooldown_base_seconds=10, cooldown_max_seconds=100)
        jar.cool_down()
        jar.revive()
        assert jar.strikes == 0
        assert jar.cool_until is None
        assert jar.is_available(datetime.now(timezone.utc))


class TestJarPool:
    def test_round_robin_order(self) -> None:
        pool = make_pool(["a", "b", "c"])
        picked = [pool.next_available().cookie for _ in range(3)]
        assert picked == ["a", "b", "c"]

    def test_empty_pool_returns_none(self) -> None:
        assert make_pool([]).next_available() is None
        assert make_pool([]).jars_total == 0
        assert make_pool([]).jars_available == 0

    def test_skips_cooling_jar(self) -> None:
        pool = make_pool(["a", "b"])
        pool._jars[0].cool_down()
        assert pool.next_available().cookie == "b"
        assert pool.jars_available == 1

    def test_exhausted_returns_none(self) -> None:
        pool = make_pool(["a", "b"])
        for jar in pool._jars:
            jar.cool_down()
        assert pool.next_available() is None
        assert pool.jars_available == 0

    def test_replace_all_resets_state_and_cursor(self) -> None:
        pool = make_pool(["a", "b"])
        pool.next_available()
        pool._jars[1].cool_down()
        pool.replace_all(["x", "y", "z"])
        assert pool.jars_total == 3
        assert pool.jars_available == 3
        picked = [pool.next_available().cookie for _ in range(2)]
        assert picked == ["x", "y"]

    def test_counts_availability(self) -> None:
        pool = make_pool(["a", "b", "c"])
        pool._jars[2].cool_down()
        assert pool.jars_total == 3
        assert pool.jars_available == 2
