"""B 站 wbi 签名:img_key/sub_key → mixin_key → 参数 md5(w_rid/wts)。

算法(社区逆向共识,见 bilibili-API-collect docs/misc/sign/wbi.md):
nav 接口返回 wbi_img.img_url/sub_url,末段文件名即 img_key/sub_key;
按 MIXIN_KEY_ENC_TAB 重排拼接键取前 32 字符得 mixin_key;签名时参数过滤
(剔除 w_rid/wts,value 清洗 !'()* 字符)→ 按 key 排序 → 追加 wts →
md5(urlencode(query) + mixin_key) 即 w_rid。

WbiKeyCache 为进程级单例(GatewayRuntime 持有):TTL 12h,nav 刷新失败
退陈旧键 best-effort(键轮换有宽限期),从未取到过键才向上抛。
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlencode

from app.adapters.bilibili.exceptions import BilibiliAdapterError
from app.log import get_logger

logger = get_logger(__name__)

#: 官方 js(brotli压缩后可读)暴露的重排表,64 项;键拼接后按表索引重排
MIXIN_KEY_ENC_TAB = (
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52,
)

#: 参与签名的 value 需剔除的字符(官方 js 同款)
_WBI_STRIP_CHARS = "!'()*"

#: 参与签名时必须剔除的既有字段(重签防叠参)
_WBI_DROP_KEYS = ("w_rid", "wts")


def derive_mixin_key(img_key: str, sub_key: str) -> str:
    """重排 img_key+sub_key 后取前 32 字符。"""
    original = img_key + sub_key
    return "".join(original[i] for i in MIXIN_KEY_ENC_TAB)[:32]


def sign_wbi_params(
    params: dict[str, Any],
    mixin_key: str,
    *,
    now: int | None = None,
) -> dict[str, str]:
    """产出带 wts/w_rid 的最终参数(值已清洗,即实际应发送的形态)。

    Args:
        params: 业务参数(w_rid/wts 若传入会被剔除重算)。
        mixin_key: derive_mixin_key 的产物。
        now: 签名时间戳(测试注入;默认当前秒)。

    Returns:
        排序无关的最终参数 dict(发送时 urlencode)。
    """
    wts = int(time.time()) if now is None else int(now)
    signed: dict[str, str] = {}
    for key in sorted(params):
        if key in _WBI_DROP_KEYS:
            continue
        value = "".join(
            ch for ch in str(params[key]) if ch not in _WBI_STRIP_CHARS
        )
        signed[key] = value
    signed["wts"] = str(wts)
    query = urlencode(signed)
    signed["w_rid"] = hashlib.md5((query + mixin_key).encode("utf-8")).hexdigest()
    return signed


def wbi_key_from_url(url: str) -> str:
    """从 nav 返回的 img/sub url 提取键(末段文件名去扩展名)。"""
    filename = url.rstrip("/").rsplit("/", 1)[-1]
    return filename.split(".")[0]


class WbiKeyCache:
    """mixin_key 进程级缓存:TTL 内复用;刷新失败退陈旧键,双失败才上抛。"""

    def __init__(
        self,
        ttl_seconds: int,
        *,
        time_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl = ttl_seconds
        self._time_fn = time_fn
        self._mixin_key: str | None = None
        self._fetched_at: float = 0.0
        self._lock = asyncio.Lock()

    def age_seconds(self) -> int | None:
        """当前键的年龄;从未取到过返回 None(health 观测用)。"""
        if self._mixin_key is None:
            return None
        return int(self._time_fn() - self._fetched_at)

    async def get(self, fetch: Callable[[], Awaitable[str]]) -> str:
        """取 mixin_key;过期/缺失时调 fetch 刷新(单飞,并发合并为一次)。

        刷新失败:有陈旧键则消费陈旧值并推进 fetched_at(故障期限流,每 TTL
        至多重试一次);从未取到过则原样上抛(调用方归因 RiskControl)。
        """
        async with self._lock:
            now = self._time_fn()
            if self._mixin_key is not None and now - self._fetched_at < self._ttl:
                return self._mixin_key
            try:
                self._mixin_key = await fetch()
            except BilibiliAdapterError as exc:
                if self._mixin_key is not None:
                    logger.warning(
                        "social_bilibili_wbi_refresh_failed_stale",
                        error=str(exc),
                        age=int(now - self._fetched_at),
                    )
                    self._fetched_at = now
                    return self._mixin_key
                raise
            self._fetched_at = now
            return self._mixin_key


__all__ = [
    "MIXIN_KEY_ENC_TAB",
    "WbiKeyCache",
    "derive_mixin_key",
    "sign_wbi_params",
    "wbi_key_from_url",
]
