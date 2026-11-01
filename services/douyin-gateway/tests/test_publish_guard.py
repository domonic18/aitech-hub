"""发布幂等闸单测(2026-11-01 CodeReview S3)。

对照的真实事故链:客户端超时不会取消服务端协程 → worker attempts=3 重试 →
同一贴图被发成多篇笔记。这里只测闸本身(纯 asyncio + 文件,不碰浏览器)。
"""
from __future__ import annotations

import asyncio
import json

import pytest

from app.xhs.publish_guard import PublishGuard, PublishInFlight


def test_record_persists_across_instances(tmp_path):
    guard = PublishGuard(str(tmp_path))
    assert guard.published("42") is False
    guard.record("42", note_url=None)
    assert guard.published("42") is True

    # 进程重启(容器换版)后标记必须还在,否则重试就会真发第二篇
    reloaded = PublishGuard(str(tmp_path))
    assert reloaded.published("42") is True
    on_disk = json.loads((tmp_path / "published.json").read_text(encoding="utf-8"))
    assert "42" in on_disk


async def test_claim_rejects_concurrent_same_pin(tmp_path):
    guard = PublishGuard(str(tmp_path))
    entered = asyncio.Event()
    release = asyncio.Event()

    async def holder() -> None:
        async with guard.claim("42"):
            entered.set()
            await release.wait()

    task = asyncio.create_task(holder())
    await entered.wait()
    # 同 pin 第二个请求立刻 409,不排队(排队会占住 gateway 并发槽几分钟)
    with pytest.raises(PublishInFlight):
        async with guard.claim("42"):
            pass
    # 不同 pin 互不影响
    async with guard.claim("43"):
        pass
    release.set()
    await task


async def test_claim_reusable_after_release(tmp_path):
    guard = PublishGuard(str(tmp_path))
    async with guard.claim("42"):
        pass
    # 失败重试路径:上一次没有落标记,锁必须能再次拿到
    async with guard.claim("42"):
        pass


def test_corrupt_marker_file_degrades_to_empty(tmp_path):
    (tmp_path / "published.json").write_text("{not json", encoding="utf-8")
    guard = PublishGuard(str(tmp_path))
    assert guard.published("42") is False
    # 坏文件后仍能正常写入并原子替换
    guard.record("42")
    assert PublishGuard(str(tmp_path)).published("42") is True
