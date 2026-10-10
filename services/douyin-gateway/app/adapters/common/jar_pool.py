"""Cookie jar 池:风控指数退避冷却 + round-robin 轮换(平台无关)。

自 douyin transport 平移(douyin/bilibili 同一套语义):jar 耗尽时由调用方
决定异常语义(本模块不 import 平台异常,保持依赖方向 jar_pool ← 各平台)。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass
class CookieJar:
    """一份 Cookie 身份;命中风控后按指数退避冷却(基数/上限来自平台 config)。"""

    cookie: str
    cooldown_base_seconds: int
    cooldown_max_seconds: int
    cool_until: datetime | None = None
    strikes: int = 0

    def is_available(self, now: datetime) -> bool:
        return self.cool_until is None or self.cool_until <= now

    def cool_down(self) -> None:
        self.strikes += 1
        seconds = min(
            self.cooldown_base_seconds * (2 ** (self.strikes - 1)),
            self.cooldown_max_seconds,
        )
        self.cool_until = datetime.now(timezone.utc) + timedelta(seconds=seconds)

    def revive(self) -> None:
        """请求成功后重置退避。"""
        self.strikes = 0
        self.cool_until = None


class JarPool:
    """多 jar 轮换(round-robin,跳过冷却中);耗尽返回 None 不抛。"""

    def __init__(
        self,
        cookies: list[str],
        *,
        cooldown_base_seconds: int,
        cooldown_max_seconds: int,
    ) -> None:
        self._cooldown_base = cooldown_base_seconds
        self._cooldown_max = cooldown_max_seconds
        self._jars = self._make_jars(cookies)
        self._cursor = 0

    def _make_jars(self, cookies: list[str]) -> list[CookieJar]:
        return [
            CookieJar(
                c,
                cooldown_base_seconds=self._cooldown_base,
                cooldown_max_seconds=self._cooldown_max,
            )
            for c in cookies
        ]

    @property
    def jars_total(self) -> int:
        return len(self._jars)

    @property
    def jars_available(self) -> int:
        now = datetime.now(timezone.utc)
        return sum(1 for jar in self._jars if jar.is_available(now))

    def replace_all(self, cookies: list[str]) -> None:
        """整体替换 jar 池(自举/手动导入后调用);冷却态一并丢弃。"""
        self._jars = self._make_jars(cookies)
        self._cursor = 0

    def next_available(self) -> CookieJar | None:
        """取下一份可用 jar(round-robin);全部冷却或未配置返回 None。"""
        now = datetime.now(timezone.utc)
        total = len(self._jars)
        if total == 0:
            return None
        for offset in range(total):
            jar = self._jars[(self._cursor + offset) % total]
            if jar.is_available(now):
                self._cursor = (self._cursor + offset + 1) % total
                return jar
        return None
