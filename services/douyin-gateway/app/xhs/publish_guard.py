"""小红书发布幂等闸(2026-11-01 CodeReview S3)。

发布是分钟级浏览器动作,而调用链有三重放大,叠加起来就是同一贴图被发成多篇笔记
(平台侧不可自动回收):

1. worker 侧 `attempts: 3` + 指数退避 —— 客户端超时即重试;
2. 客户端 `AbortSignal.timeout` 到点只是**请求端**放弃,服务端协程不会被取消,
   笔记照样发出去;
3. `/xhs/publish` 原本没有按 pin 串行、也没有幂等键,重试就是再点一次发布按钮。

本模块把「一个 pin 只发一次」收口在 gateway 侧(worker 与人工重发共用同一道闸):

- **进行中**:同 pin 的第二个请求立即 409,不排队。排队会同时顶住两个 worker
  并发槽位,而发布动辄几分钟,fail-fast 让调用方按重试策略再来更划算。
- **已成功**:落盘标记,后续请求直接返回成功(worker 据此落 synced),绝不再点
  发布按钮。
- **失败不落标记**:失败可重试是预期行为;真发布失败与「发出去但客户端没等到回执」
  的区别由人工核对渠道行决定。

标记文件与登录态同目录(published.json):同在持久卷上,容器重启不丢;重配 Cookie
只覆盖 storage_state,不清已发布记录。确需重发同一 pin(例如笔记已在平台手工删除)
时,删掉 published.json 里对应的键即可——这是刻意的「人工解闸」,不做自动过期。
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from app.log import get_logger

logger = get_logger(__name__)


class PublishInFlight(Exception):
    """同一 pin 的发布正在进行中(调用方应立即 409,不要排队等)"""

    def __init__(self, pin_id: str) -> None:
        super().__init__(f"该贴图正在发布中(pin_id={pin_id}),请稍后查看结果")
        self.pin_id = pin_id


class PublishGuard:
    """按 pin 串行 + 成功后落盘标记。进程内单例,挂在 app lifespan 上。"""

    def __init__(self, state_dir: str, filename: str = "published.json") -> None:
        self._path = os.path.join(state_dir, filename)
        self._locks: dict[str, asyncio.Lock] = {}
        self._published: dict[str, dict[str, Any]] = self._load()

    def _load(self) -> dict[str, dict[str, Any]]:
        try:
            with open(self._path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return {}
        except Exception as exc:
            # 坏文件按「从未发布过」处理:宁可多发一次也不要整个端点起不来,
            # 但必须留日志——静默把幂等标记当空,下次重试就会真发第二篇
            logger.warning("xhs.guard.load_failed", error=str(exc), path=self._path)
            return {}
        return data if isinstance(data, dict) else {}

    def _save(self) -> None:
        try:
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            tmp = f"{self._path}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._published, f, ensure_ascii=False)
            os.replace(tmp, self._path)  # 原子替换:写一半的标记文件比没有更危险
        except Exception as exc:
            # 落盘失败不影响本次返成功(笔记确实发出去了),但重试可能重发——
            # 这条必须能在日志里被找到
            logger.error("xhs.guard.save_failed", error=str(exc), path=self._path)

    def published(self, pin_id: str) -> bool:
        return pin_id in self._published

    def record(self, pin_id: str, note_url: str | None = None) -> None:
        self._published[pin_id] = {
            "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "note_url": note_url,
        }
        self._save()

    @asynccontextmanager
    async def claim(self, pin_id: str) -> AsyncIterator[None]:
        """取得该 pin 的发布权;已被占用立刻抛 PublishInFlight(排队会白占并发槽)。

        `locked()` 与 `acquire()` 之间没有 await 点,事件循环单线程下判定有效。
        """
        lock = self._locks.setdefault(pin_id, asyncio.Lock())
        if lock.locked():
            raise PublishInFlight(pin_id)
        async with lock:
            yield
