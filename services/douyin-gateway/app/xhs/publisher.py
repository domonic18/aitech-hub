"""XHS 创作平台自动发布(M49 批X3;批X3' 步骤化收口)。

本模块只管浏览器生命周期与发布编排;页面交互细节在 steps.py(命名步骤库,
PUBLISH_STEPS 为流程权威顺序),错误/现场快照在 support.py,选择器与节奏
参数在 settings.py。每步统一日志(xhs.step_*,带 pin_id/耗时/URL)+ 失败
自动落现场快照(debug/,video+截图+DOM+URL 滚动保留)——适配平台改版
先看现场。登录态经分发中心配置 Cookie;个人号低频(plan M49)。
"""
from __future__ import annotations

import os
import time
from typing import Any

from app.log import get_logger
from app.xhs import settings as cfg
from app.xhs import steps
from app.xhs.settings import XhsSettings
from app.xhs.support import (
    KIND_LOGIN,
    KIND_UNKNOWN,
    XhsPublishResult,
    XhsStateError,
    XhsStepError,
    save_failure_artifacts,
    settle_video,
)

logger = get_logger(__name__)


class XhsPublisher:
    """进程级浏览器持有者(lifespan 启停),发布按需开 context。"""

    def __init__(self, settings: XhsSettings) -> None:
        self._settings = settings
        self._pw: Any = None
        self._browser: Any = None
        self._debug_root = os.path.join(os.path.dirname(settings.storage_state_path), "debug")
        self._video_dir = os.path.join(self._debug_root, "_videos")

    async def start(self) -> None:
        # 容错降级(对齐 signer 语义):无 chromium 不拦 app 构建
        try:
            from playwright.async_api import async_playwright

            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.launch(headless=self._settings.headless)
            logger.info("xhs.browser_started")
        except Exception as exc:
            logger.warning("xhs.browser_start_failed", error=str(exc))

    async def close(self) -> None:
        for closer in (self._browser, self._pw):
            if closer is not None:
                try:
                    await closer.close()
                except Exception as exc:
                    logger.warning("xhs.browser_close_failed", error=str(exc))
        self._browser = self._pw = None

    @property
    def started(self) -> bool:
        return self._browser is not None

    def storage_state_ready(self) -> bool:
        return os.path.exists(self._settings.storage_state_path)

    async def _new_context(self, record: bool = False) -> Any:
        if not self.started:
            raise XhsStateError("浏览器未启动")
        if not self.storage_state_ready():
            raise XhsStateError("登录态未配置:请到后台分发中心-小红书渠道卡粘贴 Cookie")
        kwargs: dict[str, Any] = dict(
            storage_state=self._settings.storage_state_path,
            locale="zh-CN",
            timezone_id="Asia/Shanghai",
            viewport={"width": self._settings.viewport_width, "height": self._settings.viewport_height},
        )
        if record:
            os.makedirs(self._video_dir, exist_ok=True)
            kwargs["record_video_dir"] = self._video_dir
        return await self._browser.new_context(**kwargs)

    @staticmethod
    def _ms(t0: float) -> int:
        return int((time.monotonic() - t0) * 1000)

    async def _run_step(self, page: Any, pin_id: str | None, name: str, action: Any) -> None:
        """步骤统一壳:进出日志 + 失败现场快照与包装(唯一日志出口)。"""
        t0 = time.monotonic()
        logger.info("xhs.step_start", pin_id=pin_id, step=name)

        def log_fail(kind: str, error: str, artifact: str | None = None) -> None:
            logger.warning("xhs.step_failed", pin_id=pin_id, step=name, kind=kind,
                duration_ms=self._ms(t0), url=page.url, error=error[:200], artifact=artifact)

        try:
            await action()
        except XhsStateError as exc:
            log_fail(KIND_LOGIN, str(exc))
            raise
        except XhsStepError as exc:
            if exc.artifact_dir is None:
                exc.attach_artifact(await save_failure_artifacts(
                    page, name, self._debug_root, cfg.DEBUG_KEEP))
            log_fail(exc.kind, str(exc))
            raise
        except Exception as exc:
            dir_path = await save_failure_artifacts(page, name, self._debug_root, cfg.DEBUG_KEEP)
            log_fail(KIND_UNKNOWN, str(exc), dir_path)
            raise XhsStepError(name, KIND_UNKNOWN, f"执行异常:{str(exc)[:200]}", dir_path) from exc
        logger.info("xhs.step_ok", pin_id=pin_id, step=name,
            duration_ms=self._ms(t0), url=page.url)

    async def ingest_cookie_header(self, cookie_header: str) -> dict[str, Any]:
        """「手动贴 Cookie」:F12 cookie 串 → 验证登录 → storage_state 覆盖。"""
        if not self.started:
            raise XhsStateError("浏览器未启动")
        pairs = [
            {"name": n.strip(), "value": v.strip(), "domain": ".xiaohongshu.com", "path": "/"}
            for part in cookie_header.split(";")
            if "=" in part
            for n, _, v in [part.strip().partition("=")]
            if n and v
        ]
        if not pairs:
            raise XhsStateError("cookie 串解析为空")
        # 引导自举:首配时 storage_state 尚不存在,不能走 _new_context(其前置
        # 要求登录态已落盘——鸡生蛋死锁,2026-10-27 生产首配实测);此处裸建
        # context 只带 viewport,验证登录通过后才落盘 storage_state
        context = await self._browser.new_context(
            viewport={"width": self._settings.viewport_width, "height": self._settings.viewport_height}
        )
        await context.add_cookies(pairs)
        page = await context.new_page()
        try:
            await page.goto(self._settings.creator_publish_url,
                            wait_until="domcontentloaded", timeout=cfg.NAV_TIMEOUT_MS)
            # 401 重定向由客户端 JS 触发:等落定再判(wait 被打断则吞掉)
            try:
                await page.wait_for_timeout(cfg.LOGIN_SETTLE_MS)
            except Exception:
                pass
            logged_in = self._settings.login_marker not in page.url
        finally:
            await page.close()
        if not logged_in:
            await context.close()
            raise XhsStateError("cookie 登录验证失败(未跳离登录页),请重新复制完整 cookie")
        await context.storage_state(path=self._settings.storage_state_path)
        await context.close()
        logger.info("xhs.cookie_ingested", cookies=len(pairs))
        return {"ok": True, "logged_in": True, "cookies": len(pairs)}

    async def state(self) -> dict[str, Any]:
        """登录态 + 结构地标(只读;creator_tab 计数为唯一裸页地标)。"""
        ready = self.storage_state_ready()
        logged_in: bool | None = None
        landmarks: dict[str, Any] | None = None
        if self.started:
            context = await self._new_context()
            page = await context.new_page()
            try:
                await page.goto(self._settings.creator_publish_url,
                                timeout=cfg.STATE_NAV_TIMEOUT_MS)
                logged_in = self._settings.login_marker not in page.url
                if logged_in:
                    # 地标由客户端渲染后挂出:轮询等出现(与 tab 渲染竞态同源)
                    tabs = page.locator(self._settings.selectors["creator_tab"])
                    deadline = time.monotonic() + cfg.LANDMARK_WAIT_S
                    while time.monotonic() < deadline:
                        if await tabs.count():
                            break
                        await page.wait_for_timeout(cfg.TAB_POLL_MS)
                    landmarks = {"creator_tab": await tabs.count()}
            except Exception:
                logged_in = None
            finally:
                await context.close()
        return {
            "storage_state_ready": ready,
            "logged_in": logged_in,
            "landmarks": landmarks,
        }

    async def publish(self, title: str, content: str, images: list[str],
                      pin_id: str | None = None) -> XhsPublishResult:
        """发布图文笔记:按 PUBLISH_STEPS 权威顺序逐步执行(细节见 steps.py)。

        success 页无笔记链接可抓(实测),note_url 留空(设计允许)。
        """
        if not images:
            raise XhsStateError("至少需要 1 张图片")
        context = await self._new_context(record=True)
        page = await context.new_page()
        artifact_dir: str | None = None
        t0 = time.monotonic()
        ctx = steps.PublishCtx(
            page=page, settings=self._settings, pin_id=pin_id,
            title=title, content=content, images=images,
        )
        try:
            for name, step in steps.PUBLISH_STEPS:
                await self._run_step(page, pin_id, name, lambda s=step: s(ctx))
            logger.info("xhs.publish_done", pin_id=pin_id, ok=True, duration_ms=self._ms(t0))
            return XhsPublishResult(ok=True, note_url=None)
        except (XhsStateError, XhsStepError) as exc:
            # 现场目录回填给 finally 的视频归置(2026-10-27 实弹:此赋值曾遗漏,
            # artifact_dir 恒 None → 失败视频全走删除分支,现场只剩截图+DOM)
            artifact_dir = getattr(exc, "artifact_dir", None)
            logger.warning("xhs.publish_done", pin_id=pin_id, ok=False,
                kind=KIND_LOGIN if isinstance(exc, XhsStateError) else exc.kind,
                duration_ms=self._ms(t0), error=str(exc)[:200],
                artifact=artifact_dir)
            raise
        finally:
            video = page.video
            try:
                await context.close()  # 关闭后视频才写完,失败不得阻断归置
            except Exception as exc:
                logger.warning("xhs.context_close_failed", error=str(exc))
            await settle_video(video, artifact_dir)
