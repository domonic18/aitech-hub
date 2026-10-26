"""XHS 发布步骤库(M49 批X3' 可读性重构):每个函数一个命名步骤。

约定:
- 入参统一 PublishCtx(页面 + 物料 + 运行参数);失败抛 XhsStepError
  (步骤名/分类/人话,现场快照由 publisher._run_step 统一补拍)
- 各函数内注释均为实弹实证(2026-10-26/27 五层排障 + 多图两轮),勿凭直觉改;
  选择器与节奏参数一律取自 settings.py(唯一调参入口,实证注释随常量)
- PUBLISH_STEPS 是发布流程的权威顺序(单一事实源),新增步骤在此登记
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any, Callable

from app.xhs import settings as cfg
from app.xhs.settings import XhsSettings
from app.xhs.support import (
    KIND_CLICK,
    KIND_FILL,
    KIND_SELECTOR,
    KIND_SUCCESS_SIGNAL,
    KIND_UPLOAD,
    XhsStateError,
    XhsStepError,
)


@dataclass
class PublishCtx:
    """单次发布的运行上下文(steps 函数群唯一入参)。"""

    page: Any
    settings: XhsSettings
    pin_id: str | None
    title: str
    content: str
    images: list[str]

    @property
    def sel(self) -> dict[str, str]:
        return self.settings.selectors


async def open_page(ctx: PublishCtx) -> None:
    """打开发布页 + 登录态检查(重定向由客户端 JS 触发,等落定再判)。"""
    await ctx.page.goto(
        ctx.settings.creator_publish_url,
        wait_until="domcontentloaded",
        timeout=cfg.NAV_TIMEOUT_MS,
    )
    try:
        await ctx.page.wait_for_timeout(cfg.LOGIN_SETTLE_MS)
    except Exception:
        pass  # 等待期间页面可能被导航走(wait 被打断),以最终 URL 为准
    if ctx.settings.login_marker in ctx.page.url:
        raise XhsStateError("登录态失效,请到后台分发中心-小红书渠道卡重新配置 Cookie")


async def switch_image_tab(ctx: PublishCtx) -> None:
    """切「上传图文」tab:候选全收逐个试点,禁用序号定位。

    平台 DOM 存在视口外克隆(点中报 outside of the viewport)与 aria-hidden
    同位克隆(序号随渲染漂移)——文本+视口内+非 aria-hidden 全收,逐个
    TAB_CLICK_TIMEOUT_MS 短超时试点,谁吃下点击用谁(2026-10-26 三轮实弹收敛)。
    """
    page, sel = ctx.page, ctx.sel
    candidates: list[Any] = []
    deadline = time.monotonic() + cfg.TAB_RENDER_TIMEOUT_S
    while not candidates and time.monotonic() < deadline:
        tabs = page.locator(sel["creator_tab"])
        for i in range(await tabs.count()):
            t = tabs.nth(i)
            try:
                if ctx.settings.image_tab_text not in (await t.inner_text()):
                    continue
                if (await t.get_attribute("aria-hidden")) == "true":
                    continue
                box = await t.bounding_box()
            except Exception:
                continue  # 节点尚在挂载/被导航打断
            if box and box["x"] >= 0 and box["y"] >= 0:
                candidates.append(t)
        if not candidates:
            await page.wait_for_timeout(cfg.TAB_POLL_MS)
    if not candidates:
        raise XhsStepError("切换上传图文 tab", KIND_SELECTOR, (
            f"等待「{ctx.settings.image_tab_text}」tab 超时"
            f"({cfg.TAB_RENDER_TIMEOUT_S}s):页面可能改版或渲染异常"))
    for t in candidates:
        try:
            await t.click(timeout=cfg.TAB_CLICK_TIMEOUT_MS)
            await page.wait_for_timeout(cfg.TAB_SETTLE_MS)
            return
        except Exception:
            continue
    raise XhsStepError("切换上传图文 tab", KIND_CLICK, (
        f"「{ctx.settings.image_tab_text}」tab 候选均不可点(平台改版?)"))


async def upload_images(ctx: PublishCtx) -> None:
    """批量数组直传全部图片(set_input_files 原生支持,「N/18」计数实测)。

    轮询计数到齐再进下一步——上传中平台禁用发布钮,未到齐就点只会白失败;
    到齐后再等 UPLOAD_TAIL_SETTLE_MS(计数到齐≠字节传完)。计数元素缺失
    (平台改版)退回固定等待。平台拒收 <720P 图片但报错只在发布期出现。
    """
    page, sel = ctx.page, ctx.sel
    await page.locator(sel["upload_input"]).first.set_input_files(ctx.images)
    counter = page.get_by_text(re.compile(rf"^{len(ctx.images)}/\d+$"))
    deadline = time.monotonic() + cfg.UPLOAD_SETTLE_TIMEOUT_S
    while time.monotonic() < deadline:
        if await counter.count():
            await page.wait_for_timeout(cfg.UPLOAD_TAIL_SETTLE_MS)
            return
        await page.wait_for_timeout(cfg.UPLOAD_POLL_MS)
    if not await page.get_by_text(re.compile(r"\d+/\d+")).count():
        await page.wait_for_timeout(cfg.UPLOAD_SETTLE_MS)
        return
    raise XhsStepError("上传图片", KIND_UPLOAD, (
        f"上传计数未到 {len(ctx.images)}(超时 {cfg.UPLOAD_SETTLE_TIMEOUT_S}s)"))


async def fill_fields(ctx: PublishCtx) -> None:
    """填标题与正文:回读校验,不稳则重填。

    图片异步上传完成触发编辑区重渲染,先填入的标题(input 值)可能被清空,
    正文(TipTap 富文本状态)扛得住——故逐字段回读(空白归一比对),
    FILL_VERIFY_TIMEOUT_S 内仍不稳定按失败上抛(2026-10-27 实收:多图笔记
    有文无题)。
    """
    page, sel = ctx.page, ctx.sel
    cases = [
        (
            "填写标题",
            page.locator(sel["title_input"]).first,
            ctx.title[:20],  # 平台上限 20 字
            lambda b: b.input_value(),
        ),
        (
            "填写正文",
            page.locator(sel["content_editor"]).first,
            ctx.content[:1000],  # 平台上限 1000 字
            lambda b: b.inner_text(),
        ),
    ]
    for name, box, expected, read in cases:
        want = re.sub(r"\s", "", expected)
        deadline = time.monotonic() + cfg.FILL_VERIFY_TIMEOUT_S
        while True:
            await box.fill(expected)
            got = re.sub(r"\s", "", await read(box))
            if want in got:
                break
            if time.monotonic() > deadline:
                raise XhsStepError(
                    name, KIND_FILL, "回读校验失败(填入即被清空,页面重渲染?)"
                )
            await page.wait_for_timeout(cfg.FILL_RETRY_MS)


async def click_publish(ctx: PublishCtx) -> None:
    """点击发布:closed shadow root 对 DOM 查询全盲,宿主仅作存在性断言。

    绝对坐标=红钮中心(viewport 钉死 1280×720 截图实测;宿主 bounding box
    含整个内容列,相对计算曾点到红钮右侧空白,m49-x9 教训)。点击前最后一刻
    复核标题(迟到的重渲染仍可能清空,2026-10-27 实收)。
    """
    page, sel = ctx.page, ctx.sel
    if not await page.locator(cfg.PUBLISH_BAR_HOST).count():
        raise XhsStepError(
            "点击发布", KIND_SELECTOR, "发布页底部操作栏缺失(平台改版?)"
        )
    title_input = page.locator(sel["title_input"]).first
    if (await title_input.input_value()) != ctx.title[:20]:
        await title_input.fill(ctx.title[:20])
    await page.mouse.click(cfg.PUBLISH_CLICK_X, cfg.PUBLISH_CLICK_Y)


async def await_success(ctx: PublishCtx) -> None:
    """等待发布成功信号,无响应周期性补击。

    成功信号(实测):跳 /publish/success → 回跳带 published=true;explore
    跳转并不发生。补击:计数到齐≠字节传完,首击可能落禁用钮无效果——每
    PUBLISH_RECLICK_MS 复点直至成功或超时(成功即跳离发布页,复点不会二次
    发布;2026-10-27 多图实弹教训)。
    """
    page = ctx.page
    deadline = time.monotonic() + cfg.PUBLISH_CONFIRM_TIMEOUT_S
    next_click = time.monotonic() + cfg.PUBLISH_RECLICK_MS
    while time.monotonic() < deadline:
        u = page.url
        if "/publish/success" in u or "published=true" in u:
            return
        if time.monotonic() >= next_click:
            await page.mouse.click(cfg.PUBLISH_CLICK_X, cfg.PUBLISH_CLICK_Y)
            next_click = time.monotonic() + cfg.PUBLISH_RECLICK_MS
        await page.wait_for_timeout(cfg.PUBLISH_POLL_MS)
    raise XhsStepError("确认发布结果", KIND_SUCCESS_SIGNAL, (
        "点击发布后未检测到成功跳转(素材校验被拒或上传未完成)"))


#: 发布流程的权威顺序(单一事实源;新增步骤在此登记)
PUBLISH_STEPS: list[tuple[str, Callable[[PublishCtx], Awaitable[None]]]] = [
    ("打开发布页", open_page),
    ("切换上传图文 tab", switch_image_tab),
    ("上传图片", upload_images),
    ("填写标题与正文", fill_fields),
    ("点击发布", click_publish),
    ("确认发布结果", await_success),
]
