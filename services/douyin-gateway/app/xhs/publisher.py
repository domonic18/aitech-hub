"""XHS 创作平台自动发布(M49 批X3 POC):

Playwright 驱动创作平台(creator.xiaohongshu.com)网页发布流程——选择器
译自社区 xhs-mcp-server v0.2.8 实证(creator-tab/upload-input/d-text/
ql-editor/publishBtn),**平台改版即漂移,需实测迭代**。

登录态:storage_state JSON(scripts/xhs_login.py 有头浏览器人工登录一次
落盘,cookie 过期后重跑续期);发布动作在无头容器执行。

风控边界:自动化属 ToS 灰区——限定站长个人号低频使用(plan M49)。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.log import get_logger
from app.xhs.settings import XhsSettings

logger = get_logger(__name__)


class XhsStateError(RuntimeError):
    """登录态缺失/失效(人话直出给渠道行 lastError)。"""


@dataclass
class XhsPublishResult:
    ok: bool
    note_url: str | None = None


class XhsPublisher:
    """进程级浏览器持有者(lifespan 启停),发布按需开 context。"""

    def __init__(self, settings: XhsSettings) -> None:
        self._settings = settings
        self._pw: Any = None
        self._browser: Any = None

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
        import os

        return os.path.exists(self._settings.storage_state_path)

    async def _new_context(self) -> Any:
        if not self.started:
            raise XhsStateError("浏览器未启动")
        if not self.storage_state_ready():
            raise XhsStateError(
                "登录态未初始化:先在有头环境跑 scripts/xhs_login.py 人工登录一次"
            )
        return await self._browser.new_context(
            storage_state=self._settings.storage_state_path,
            locale="zh-CN",
            timezone_id="Asia/Shanghai",
        )

    async def ingest_cookie_header(self, cookie_header: str) -> dict[str, Any]:
        """抖音同款「手动贴 Cookie」入口:F12 复制的 cookie 串 → storage_state。

        只解析 name=value(域/路径按 .xiaohongshu.com + / 补全,session 级足够
        单次发布 context 存活);粘贴后访问创作平台验证登录,成功才落盘覆盖。
        """
        import os

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
        context = await self._browser.new_context()
        await context.add_cookies(pairs)
        page = await context.new_page()
        try:
            await page.goto(
                self._settings.creator_publish_url,
                wait_until="domcontentloaded",
                timeout=60_000,
            )
            # 401 重定向为客户端 JS 触发:等落定再判,否则假阳性
            await page.wait_for_timeout(3000)
            logged_in = "login" not in page.url
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
        """登录态概况(运维探针):state 文件在否 + 探测页登录判定。"""
        ready = self.storage_state_ready()
        logged_in: bool | None = None
        if self.started:
            context = await self._new_context()
            page = await context.new_page()
            try:
                await page.goto(self._settings.creator_publish_url, timeout=30_000)
                logged_in = "login" not in page.url
            except Exception:
                logged_in = None
            finally:
                await context.close()
        return {"storage_state_ready": ready, "logged_in": logged_in}

    async def publish(
        self, title: str, content: str, images: list[str]
    ) -> XhsPublishResult:
        """发布图文笔记:上传图片 → 标题/正文 → 提交;尽力抓笔记链接。"""
        if not images:
            raise XhsStateError("至少需要 1 张图片")
        context = await self._new_context()
        page = await context.new_page()
        try:
            await page.goto(
                self._settings.creator_publish_url,
                wait_until="domcontentloaded",
                timeout=60_000,
            )
            # 同 ingest:等客户端 401 重定向落定再判登录态
            await page.wait_for_timeout(3000)
            if "login" in page.url:
                raise XhsStateError("登录态失效,请重跑 xhs_login 续期")
            # 上传图片(POC 选择器,平台改版需迭代)
            upload = page.locator(".upload-input").first
            await upload.set_input_files(images)
            await page.wait_for_timeout(3000)
            # 标题(截断到 20 字,与渠道行硬闸同口径)
            trimmed = title[:20]
            title_input = page.locator(".d-text").first
            await title_input.fill(trimmed)
            # 正文(ql-editor 富文本)
            content_box = page.locator(".ql-editor").first
            await content_box.fill(content)
            # 发布
            await page.locator(".publishBtn").first.click()
            # 发布后跳转/成功提示需数秒;尽力抓笔记链接(抓不到留空,人工补)
            note_url: str | None = None
            try:
                await page.wait_for_url("**/explore/**", timeout=30_000)
                note_url = page.url
            except Exception:
                note_url = None
            logger.info("xhs.published", title=trimmed, note_url=note_url)
            return XhsPublishResult(ok=True, note_url=note_url)
        except XhsStateError:
            raise
        except Exception as exc:
            raise RuntimeError(f"小红书发布失败: {exc}") from exc
        finally:
            await context.close()
