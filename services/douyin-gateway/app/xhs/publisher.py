"""XHS 创作平台自动发布(M49 批X3;批X3' 步骤化收口)。

每步统一日志(xhs.step_*,带 pin_id/耗时/URL)+ 失败自动落现场快照
(workspace/xhs-state/debug/,video+截图+DOM+URL 滚动保留)——适配平台
改版先看现场,禁止盲猜选择器;步骤闭包内注释均为实弹实证,勿凭直觉改。
登录态经后台分发中心渠道卡粘贴 Cookie 录入;风控边界:个人号低频(plan M49)。
"""
from __future__ import annotations

import os
import time
from typing import Any, Awaitable, Callable

from app.log import get_logger
from app.xhs import settings as cfg
from app.xhs.settings import XhsSettings
from app.xhs.support import (
    KIND_CLICK,
    KIND_LOGIN,
    KIND_SELECTOR,
    KIND_SUCCESS_SIGNAL,
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
        # 失败现场根 = 登录态卷同级 debug/(宿主 workspace/xhs-state/debug)
        self._debug_root = os.path.join(
            os.path.dirname(settings.storage_state_path), "debug"
        )
        self._video_dir = os.path.join(self._debug_root, "_videos")

    async def start(self) -> None:
        # 容错降级(对齐 signer BrowserUnavailable 语义):测试环境无 chromium
        # 不拦 app 构建,publish 端点以「浏览器未启动」人话失败
        try:
            from playwright.async_api import async_playwright

            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.launch(
                headless=self._settings.headless
            )
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
        self._browser = None
        self._pw = None

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
            viewport={
                "width": self._settings.viewport_width,
                "height": self._settings.viewport_height,
            },
        )
        if record:
            os.makedirs(self._video_dir, exist_ok=True)
            kwargs["record_video_dir"] = self._video_dir
        return await self._browser.new_context(**kwargs)

    @staticmethod
    def _ms(t0: float) -> int:
        return int((time.monotonic() - t0) * 1000)

    async def _run_step(
        self,
        page: Any,
        pin_id: str | None,
        name: str,
        action: Callable[[], Awaitable[None]],
    ) -> None:
        """步骤统一壳:进出日志 + 失败现场快照与包装(唯一日志出口)。"""
        t0 = time.monotonic()
        logger.info("xhs.step_start", pin_id=pin_id, step=name)

        def log_fail(kind: str, error: str, artifact: str | None = None) -> None:
            logger.warning(
                "xhs.step_failed", pin_id=pin_id, step=name, kind=kind,
                duration_ms=self._ms(t0), url=page.url, error=error[:200],
                artifact=artifact,
            )

        try:
            await action()
        except XhsStateError as exc:
            log_fail(KIND_LOGIN, str(exc))
            raise
        except XhsStepError as exc:
            if exc.artifact_dir is None:
                exc.attach_artifact(
                    await save_failure_artifacts(
                        page, name, self._debug_root, cfg.DEBUG_KEEP
                    )
                )
            log_fail(exc.kind, str(exc))
            raise
        except Exception as exc:
            dir_path = await save_failure_artifacts(
                page, name, self._debug_root, cfg.DEBUG_KEEP
            )
            log_fail(KIND_UNKNOWN, str(exc), dir_path)
            raise XhsStepError(
                name, KIND_UNKNOWN, f"执行异常:{str(exc)[:200]}", dir_path
            ) from exc
        logger.info(
            "xhs.step_ok", pin_id=pin_id, step=name,
            duration_ms=self._ms(t0), url=page.url,
        )

    async def ingest_cookie_header(self, cookie_header: str) -> dict[str, Any]:
        """「手动贴 Cookie」入口:F12 复制的 cookie 串 → 验证登录 → storage_state。

        只解析 name=value(域/路径按 .xiaohongshu.com + / 补全);粘贴后访问
        创作平台验证,成功才落盘覆盖。
        """
        if not self.started:
            raise XhsStateError("浏览器未启动")
        pairs: list[dict[str, str]] = []
        for part in cookie_header.split(";"):
            if "=" not in part:
                continue
            name, _, value = part.strip().partition("=")
            if name and value:
                pairs.append(
                    {
                        "name": name.strip(),
                        "value": value.strip(),
                        "domain": ".xiaohongshu.com",
                        "path": "/",
                    }
                )
        if not pairs:
            raise XhsStateError("cookie 串解析为空")
        context = await self._new_context()
        await context.add_cookies(pairs)
        page = await context.new_page()
        try:
            await page.goto(
                self._settings.creator_publish_url,
                wait_until="domcontentloaded",
                timeout=cfg.NAV_TIMEOUT_MS,
            )
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
        """登录态概况 + 页面结构地标(只读导航,零发布风险):改版早发现,
        不必拿真实发布当探针。"""
        ready = self.storage_state_ready()
        logged_in: bool | None = None
        landmarks: dict[str, Any] | None = None
        if self.started:
            context = await self._new_context()
            page = await context.new_page()
            try:
                await page.goto(
                    self._settings.creator_publish_url,
                    timeout=cfg.STATE_NAV_TIMEOUT_MS,
                )
                logged_in = self._settings.login_marker not in page.url
                if logged_in:
                    # 地标由客户端渲染后挂出:轮询等出现(与 tab 渲染竞态同源)
                    deadline = time.monotonic() + cfg.LANDMARK_WAIT_S
                    while time.monotonic() < deadline:
                        if await page.locator(
                            self._settings.selectors["creator_tab"]
                        ).count():
                            break
                        await page.wait_for_timeout(cfg.TAB_POLL_MS)
                    landmarks = {
                        "creator_tab": await page.locator(
                            self._settings.selectors["creator_tab"]
                        ).count(),
                        "publish_bar": await page.locator(cfg.PUBLISH_BAR_HOST).count(),
                    }
            except Exception:
                logged_in = None
            finally:
                await context.close()
        return {
            "storage_state_ready": ready,
            "logged_in": logged_in,
            "landmarks": landmarks,
        }

    async def publish(
        self,
        title: str,
        content: str,
        images: list[str],
        pin_id: str | None = None,
    ) -> XhsPublishResult:
        """发布图文笔记:打开→登录检查→切 tab→上传→标题→正文→发布→确认。

        各步骤闭包内注释均为实弹实证(2026-10-26/27 五层排障);选择器与
        节奏参数实证依据见 settings.py 注释与设计文档 §6.2 Runbook。
        """
        if not images:
            raise XhsStateError("至少需要 1 张图片")
        context = await self._new_context(record=True)
        page = await context.new_page()
        artifact_dir: str | None = None
        t0 = time.monotonic()
        sel = self._settings.selectors

        async def open_page() -> None:
            await page.goto(
                self._settings.creator_publish_url,
                wait_until="domcontentloaded",
                timeout=cfg.NAV_TIMEOUT_MS,
            )
            # 登录重定向由客户端 JS 触发:等落定再判(wait 被打断则吞掉)
            try:
                await page.wait_for_timeout(cfg.LOGIN_SETTLE_MS)
            except Exception:
                pass
            if self._settings.login_marker in page.url:
                raise XhsStateError(
                    "登录态失效,请到后台分发中心-小红书渠道卡重新配置 Cookie"
                )

        async def switch_image_tab() -> None:
            # 候选全收(文本匹配+视口内+非 aria-hidden)逐个短超时试点:
            # 平台 DOM 存在视口外/aria-hidden 同位克隆且序号随渲染漂移,
            # 序号定位必炸(2026-10-26 三轮实弹收敛)
            candidates: list[Any] = []
            deadline = time.monotonic() + cfg.TAB_RENDER_TIMEOUT_S
            while not candidates and time.monotonic() < deadline:
                tabs = page.locator(sel["creator_tab"])
                for i in range(await tabs.count()):
                    t = tabs.nth(i)
                    try:
                        if self._settings.image_tab_text not in (await t.inner_text()):
                            continue
                        if (await t.get_attribute("aria-hidden")) == "true":
                            continue
                        box = await t.bounding_box()
                    except Exception:
                        continue  # 节点尚在挂载/等待中被导航打断
                    if box and box["x"] >= 0 and box["y"] >= 0:
                        candidates.append(t)
                if not candidates:
                    await page.wait_for_timeout(cfg.TAB_POLL_MS)
            if not candidates:
                raise XhsStepError(
                    "切换上传图文 tab", KIND_SELECTOR,
                    f"等待「{self._settings.image_tab_text}」tab 超时"
                    f"({cfg.TAB_RENDER_TIMEOUT_S}s):页面可能改版或渲染异常",
                )
            for t in candidates:
                try:
                    await t.click(timeout=cfg.TAB_CLICK_TIMEOUT_MS)
                    await page.wait_for_timeout(cfg.TAB_SETTLE_MS)
                    return
                except Exception:
                    continue
            raise XhsStepError(
                "切换上传图文 tab", KIND_CLICK,
                f"「{self._settings.image_tab_text}」tab 候选均不可点(平台改版?)",
            )

        async def upload_images() -> None:
            # 仅传首张(封面);平台拒收 <720P 图片但报错只在发布期出现
            await page.locator(sel["upload_input"]).first.set_input_files(images[0])
            await page.wait_for_timeout(cfg.UPLOAD_SETTLE_MS)

        async def fill_title() -> None:
            await page.locator(sel["title_input"]).first.fill(title[:20])  # 平台上限 20 字

        async def fill_content() -> None:
            await page.locator(sel["content_editor"]).first.fill(content[:1000])

        async def click_publish() -> None:
            # closed shadow root 对 DOM 查询全盲:宿主仅作存在性断言,点击用
            # 绝对坐标=红钮中心(宿主相对计算曾点到红钮右侧空白,m49-x9 教训)
            if not await page.locator(cfg.PUBLISH_BAR_HOST).count():
                raise XhsStepError(
                    "点击发布", KIND_SELECTOR, "发布页底部操作栏缺失(平台改版?)"
                )
            await page.mouse.click(cfg.PUBLISH_CLICK_X, cfg.PUBLISH_CLICK_Y)

        async def await_success() -> None:
            # 成功信号(实测):跳 /publish/success → 回跳带 published=true;
            # explore 不发生。超时=未发出,必须按失败上抛(不得无条件 ok——
            # 曾把未发出误记 synced)
            deadline = time.monotonic() + cfg.PUBLISH_CONFIRM_TIMEOUT_S
            while time.monotonic() < deadline:
                u = page.url
                if "/publish/success" in u or "published=true" in u:
                    return
                await page.wait_for_timeout(cfg.PUBLISH_POLL_MS)
            raise XhsStepError(
                "确认发布结果", KIND_SUCCESS_SIGNAL,
                "点击发布后未检测到成功跳转(可能素材校验被拒,如图片低于 720P)",
            )

        try:
            await self._run_step(page, pin_id, "打开发布页", open_page)
            await self._run_step(page, pin_id, "切换上传图文 tab", switch_image_tab)
            await self._run_step(page, pin_id, "上传图片", upload_images)
            await self._run_step(page, pin_id, "填写标题", fill_title)
            await self._run_step(page, pin_id, "填写正文", fill_content)
            await self._run_step(page, pin_id, "点击发布", click_publish)
            await self._run_step(page, pin_id, "确认发布结果", await_success)
            # success 页无笔记链接可抓(实测),note_url 留空(设计允许)
            logger.info(
                "xhs.publish_done", pin_id=pin_id, ok=True, duration_ms=self._ms(t0)
            )
            return XhsPublishResult(ok=True, note_url=None)
        except XhsStateError as exc:
            logger.warning(
                "xhs.publish_done", pin_id=pin_id, ok=False, kind=KIND_LOGIN,
                duration_ms=self._ms(t0), error=str(exc)[:200],
            )
            raise
        except XhsStepError as exc:
            artifact_dir = exc.artifact_dir
            logger.warning(
                "xhs.publish_done", pin_id=pin_id, ok=False, kind=exc.kind,
                duration_ms=self._ms(t0), error=str(exc)[:200], artifact=artifact_dir,
            )
            raise
        finally:
            video = page.video
            await context.close()
            await settle_video(video, artifact_dir)
