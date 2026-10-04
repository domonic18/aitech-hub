"""进程内日志:structlog 风格 kwargs 调用由 std logging 承载。

平移自 ai-invest-assisstant(上游用 structlog);网关体量不需要结构化
日志管线,仅保留「事件名 + key=value」的消息形状,采集侧 grep 习惯不变。
"""

from __future__ import annotations

import logging
from typing import Any


class _KwLogger:
    """``logger.info("event", k=v)`` → ``event k=v k2=v2``(空 kwargs 退化为纯事件名)。"""

    __slots__ = ("_logger",)

    def __init__(self, name: str) -> None:
        self._logger = logging.getLogger(name)

    def _emit(self, level: int, event: str, kw: dict[str, Any]) -> None:
        if self._logger.isEnabledFor(level):
            suffix = " ".join(f"{key}={value}" for key, value in kw.items())
            self._logger.log(level, f"{event} {suffix}".strip())

    def debug(self, event: str, **kw: Any) -> None:
        self._emit(logging.DEBUG, event, kw)

    def info(self, event: str, **kw: Any) -> None:
        self._emit(logging.INFO, event, kw)

    def warning(self, event: str, **kw: Any) -> None:
        self._emit(logging.WARNING, event, kw)

    def error(self, event: str, **kw: Any) -> None:
        self._emit(logging.ERROR, event, kw)


def get_logger(name: str) -> _KwLogger:
    return _KwLogger(name)
