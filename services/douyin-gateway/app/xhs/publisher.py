"""XHS 创作平台自动发布(M49 批X3 POC):

Playwright 驱动创作平台(creator.xiaohongshu.com)网页发布流程——选择器
译自社区 xhs-mcp-server v0.2.8 实证(creator-tab/upload-input/d-text/
ql-editor/publishBtn),**平台改版即漂移,需实测迭代**。

登录态:storage_state JSON(后台分发中心渠道卡粘贴 Cookie 录入,gateway
验证登录后落盘;过期后在配置界面重贴续期);发布动作在无头容器执行。

风控边界:自动化属 ToS 灰区——限定站长个人号低频使用(plan M49)。
"""
from __future__ import annotations

import time
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
            raise XhsStateError("登录态未配置:请到后台分发中心-小红书渠道卡粘贴 Cookie")
        return await self._browser.new_context(
            storage_state=self._settings.storage_state_path,
            locale="zh-CN",
            timezone_id="Asia/Shanghai",
            viewport={
                "width": self._settings.viewport_width,
                "height": self._settings.viewport_height,
            },
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
        context = await self._browser.new_context(
            viewport={
                "width": self._settings.viewport_width,
                "height": self._settings.viewport_height,
            }
        )
        await context.add_cookies(pairs)
        page = await context.new_page()
        try:
            await page.goto(
                self._settings.creator_publish_url,
                wait_until="domcontentloaded",
                timeout=60_000,
            )
            # 401 重定向为客户端 JS 触发:等落定再判,否则假阳性。
            # 等待期间页面可能被导航走(wait 被打断)——吞掉中断,以最终 URL 为准
            try:
                await page.wait_for_timeout(3000)
            except Exception:
                pass
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
        """发布图文笔记:切换到「上传图文」tab → 上传图片 → 标题/正文 → 提交。"""
        if not images:
            raise XhsStateError("至少需要 1 张图片")
        step = "打开发布页"
        context = await self._new_context()
        page = await context.new_page()
        try:
            await page.goto(
                self._settings.creator_publish_url,
                wait_until="domcontentloaded",
                timeout=60_000,
            )
            # 同 ingest:等客户端 401 重定向落定再判登录态
            try:
                await page.wait_for_timeout(3000)
            except Exception:
                pass
            if "login" in page.url:
                raise XhsStateError("登录态失效,请到后台分发中心-小红书渠道卡重新配置 Cookie")
            # 切「上传图文」tab:按「可见文本+视口内」定位(平台 DOM 每个 tab
            # 都有视口外的隐藏克隆节点,序号定位会点中克隆,超时报
            # 「element is outside of the viewport」,2026-10-26 实测)
            step = "切换上传图文 tab"
            sel = self._settings.selectors
            # tab 定位三轮实弹收敛(2026-10-26):同位克隆/序号漂移防不胜防
            # (aria-hidden 装饰节点与真身同坐标,序号随渲染漂移)——终态策略:
            # 15s 内轮询收集全部候选(文本匹配 + 视口内 + 非 aria-hidden),
            # 逐个 5s 短超时试点,谁真正吃下点击用谁
            candidates: list[Any] = []
            deadline = time.monotonic() + 15
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
                    await page.wait_for_timeout(500)
            if not candidates:
                raise RuntimeError(
                    f"等待「{self._settings.image_tab_text}」tab 超时(15s):页面可能改版或渲染异常"
                )
            for t in candidates:
                try:
                    await t.click(timeout=5000)
                    break
                except Exception:
                    continue
            else:
                raise RuntimeError(
                    f"「{self._settings.image_tab_text}」tab 点击失败:候选均不可点(平台改版?)"
                )
            await page.wait_for_timeout(1000)
            # 上传封面图(首张)
            step = "上传图片"
            upload = page.locator(sel["upload_input"]).first
            await upload.set_input_files(images[0])
            await page.wait_for_timeout(3000)
            # 标题/正文按平台上限截断(全自动流程不被超长卡住):标题 20 字
            step = "填写标题"
            trimmed = title[:20]
            await page.locator(sel["title_input"]).first.fill(trimmed)
            # 正文(TipTap/ProseMirror 富文本,平台上限 1000 字)
            step = "填写正文"
            await page.locator(sel["content_editor"]).first.fill(content[:1000])
            # 发布:操作栏是 Web Component <xhs-publish-btn>,按钮渲染在 closed
            # shadow root——DOM 查询全盲(text=/CSS/button 枚举 0 命中,截图却
            # 可见)。宿主仅作存在性断言;点击用绝对坐标 (700,675)=红钮中心
            # (viewport 钉死 1280×720 下两次截图实测;宿主几何含整个内容列,
            # 相对计算会点到红钮右侧空白——m49-x9 实弹教训)
            step = "点击发布"
            if not await page.locator("xhs-publish-btn").count():
                raise RuntimeError("发布页底部操作栏缺失(平台改版?)")
            await page.mouse.click(700, 675)
            # 成功判定(必须实测,不得无条件 ok=True——曾把未发出误记 synced):
            # 平台跳 /publish/success(「发布成功」页,4s 后自动回发布页),
            # 最终 URL 带 published=true;explore 跳转并不发生
            step = "确认发布结果"
            deadline = time.monotonic() + 40
            success = False
            while time.monotonic() < deadline:
                u = page.url
                if "/publish/success" in u or "published=true" in u:
                    success = True
                    break
                await page.wait_for_timeout(500)
            if not success:
                raise RuntimeError(
                    "点击发布后未检测到成功跳转(可能素材校验被拒,如图片低于 720P)"
                )
            # success 页无笔记链接可抓(实测),note_url 留空(设计允许,渠道行
            # 记账不受影响;链接可日后从创作平台笔记管理人工补)
            logger.info("xhs.published", title=trimmed, note_url=None)
            return XhsPublishResult(ok=True, note_url=None)
        except XhsStateError:
            raise
        except Exception as exc:
            # 人话+步骤名进渠道行 lastError(§6.2);Playwright 日志截断防撑爆
            raise RuntimeError(f"小红书发布失败[{step}]: {str(exc)[:300]}") from exc
        finally:
            await context.close()
