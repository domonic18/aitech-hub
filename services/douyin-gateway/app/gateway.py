"""数据网关 HTTP 面:抖音签名 + 双平台(B站/抖音)作品列表/主页/短链,无鉴权。

只监听 compose 私有网络(与上游 signer 同一信任模型:两个共享内网的容器
之间加鉴权只增加密钥轮换与配置错误面,不移动信任边界)。路由保持薄:
parse → runtime/adapter → shape reply;每个值得测的决策都在
transport/service/slots。容器入口 ``app.gateway:app``(uvicorn 单 worker——
进程内有状态运行时,禁多 worker)。
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

from app.adapters.bilibili import exceptions as bili_exceptions
from app.adapters.bilibili.api import BilibiliWebApi
from app.adapters.common.egress import EgressError
from app.adapters.douyin.api import DouyinWebApi
from app.adapters.douyin.exceptions import (
    AccountInvalidError,
    DouyinAdapterError,
    RiskControlError,
)
from app.gateway_runtime import GatewayRuntime
from app.log import get_logger
from app.signer.backend import BrowserUnavailableError, SignPageError
from app.signer.models import HealthResponse, SignRequest, SignResponse
from app.signer.settings import SignerSettings
from app.xhs.publisher import XhsPublisher
from app.xhs.settings import XhsSettings
from app.xhs.publisher import XhsStateError
from app.signer.validation import (
    SignRequestError,
    parse_cookie_header,
    validate_path,
    validate_query,
    validate_user_agent,
)

logger = get_logger(__name__)

#: 抖音 sec_uid 形态:MS4wLjABAAAA 前缀 + base64 变体字符(与上游一致)
SEC_UID_PATTERN = re.compile(r"MS4wLjABAAAA[A-Za-z0-9_-]{20,}")

#: B 站 mid 形态:1-16 位数字;BV 号:BV + 10 位 base58
MID_PATTERN = re.compile(r"\d{1,16}")
SPACE_MID_PATTERN = re.compile(r"space\.bilibili\.com/(\d{1,16})")
BVID_PATTERN = re.compile(r"BV[1-9A-HJ-NP-Za-km-z]{10}")

#: 单次 /posts 最大翻页数(上游 SOCIAL_MAX_LIST_PAGES 同值)
POSTS_MAX_PAGES = 3

#: 代理探针可注入点(测试零真网;None=真实 curl_cffi 探测)
_probe_runner: Callable[[str], Awaitable[tuple[bool, int, str]]] | None = None


def extract_mid(text: str) -> str | None:
    """从 space 主页链接提取 B 站 mid;裸数字串原样视为 mid。"""
    stripped = text.strip()
    if MID_PATTERN.fullmatch(stripped):
        return stripped
    match = SPACE_MID_PATTERN.search(text)
    return match.group(1) if match else None


class PostsRequest(BaseModel):
    """作品列表请求;cookies 为平台级 jar 池(调用方持久化,网关零密钥)。

    sec_uid 语义按 platform 分流:douyin=sec_uid(≥10 字符),bilibili=mid
    (1-16 位数字);模型层负例(如 douyin 短 sec_uid)继续 422。
    """

    platform: Literal["douyin", "bilibili"] = "douyin"
    sec_uid: str = Field(min_length=1, max_length=128)
    cookies: list[str] = Field(default_factory=list)
    max_pages: int = Field(default=1, ge=1, le=POSTS_MAX_PAGES)
    #: 出站代理(M33 批B,可选):随请求携带网关零密钥;None=直连
    proxy: str | None = Field(default=None, min_length=8, max_length=500)

    @model_validator(mode="after")
    def _check_identity(self) -> "PostsRequest":
        if self.platform == "bilibili":
            if not MID_PATTERN.fullmatch(self.sec_uid.strip()):
                raise ValueError("bilibili sec_uid 须为 1-16 位数字 mid")
        elif len(self.sec_uid.strip()) < 10:
            raise ValueError("sec_uid too short")
        return self


class VideoOut(BaseModel):
    """作品归一化投影;play_url 仅作链路能力透出,调用方禁止落库/分发。

    play_count 仅 bilibili 有值(douyin 恒 null)。
    """

    video_id: str
    caption: str | None = None
    topic_tags: list[str] = Field(default_factory=list)
    cover_url: str | None = None
    play_url: str | None = None
    duration_seconds: int | None = None
    published_at: datetime | None = None
    digg_count: int | None = None
    comment_count: int | None = None
    share_count: int | None = None
    play_count: int | None = None


class PostsResponse(BaseModel):
    videos: list[VideoOut]
    has_more: bool
    max_cursor: int


class ProfileRequest(BaseModel):
    platform: Literal["douyin", "bilibili"] = "douyin"
    sec_uid: str = Field(min_length=1, max_length=128)
    cookies: list[str] = Field(default_factory=list)
    proxy: str | None = Field(default=None, min_length=8, max_length=500)

    @model_validator(mode="after")
    def _check_identity(self) -> "ProfileRequest":
        if self.platform == "bilibili":
            if not MID_PATTERN.fullmatch(self.sec_uid.strip()):
                raise ValueError("bilibili sec_uid 须为 1-16 位数字 mid")
        elif len(self.sec_uid.strip()) < 10:
            raise ValueError("sec_uid too short")
        return self


class ProfileResponse(BaseModel):
    sec_uid: str
    nickname: str
    avatar_url: str | None = None


class ResolveRequest(BaseModel):
    """主页链接/分享短链/裸标识(douyin sec_uid、bilibili mid)的任意形态输入。"""

    platform: Literal["douyin", "bilibili"] = "douyin"
    url: str = Field(min_length=1, max_length=2000)
    cookies: list[str] = Field(default_factory=list)
    proxy: str | None = Field(default=None, min_length=8, max_length=500)

    @model_validator(mode="after")
    def _check_url_floor(self) -> "ResolveRequest":
        # bilibili 允许裸 mid(可短至 1 位);douyin 保持旧 url 下限 8 字符
        if self.platform == "douyin" and len(self.url.strip()) < 8:
            raise ValueError("url too short")
        return self


class ResolveResponse(BaseModel):
    sec_uid: str


class PlayUrlRequest(BaseModel):
    """播放直链现查(仅 bilibili:durl 需 view→cid→playurl 两次请求)。

    play_url 版权红线:仅 job data 过境即焚,调用方禁止落库/分发。
    """

    platform: Literal["bilibili"] = "bilibili"
    video_id: str = Field(min_length=1, max_length=64)
    cookies: list[str] = Field(default_factory=list)
    proxy: str | None = Field(default=None, min_length=8, max_length=500)

    @model_validator(mode="after")
    def _check_bvid(self) -> "PlayUrlRequest":
        if not BVID_PATTERN.fullmatch(self.video_id.strip()):
            raise ValueError("bilibili video_id 须为 BV 号(BV + 10 位)")
        return self


class PlayUrlResponse(BaseModel):
    video_id: str
    play_url: str | None = None


class SubtitleRequest(BaseModel):
    """字幕文本现查(M33 批C,仅 bilibili:字幕优先于直链+ASR 的取材通道)。

    登录态(含 SESSDATA)才见 AI 字表(ai-zh);字幕文本是「转写输入」非
    资产,调用方禁落库(与转写同红线)。
    """

    platform: Literal["bilibili"] = "bilibili"
    video_id: str = Field(min_length=1, max_length=64)
    cookies: list[str] = Field(default_factory=list)
    proxy: str | None = Field(default=None, min_length=8, max_length=500)

    @model_validator(mode="after")
    def _check_bvid(self) -> "SubtitleRequest":
        if not BVID_PATTERN.fullmatch(self.video_id.strip()):
            raise ValueError("bilibili video_id 须为 BV 号(BV + 10 位)")
        return self


class SubtitleResponse(BaseModel):
    video_id: str
    subtitle_text: str | None = None
    lang: str | None = None


class PlatformHealth(BaseModel):
    jars_total: int = 0
    jars_available: int = 0
    wbi_age_seconds: int | None = None


class GatewayHealthResponse(HealthResponse):
    """签名健康 + 分平台 jar 池观测;永远 200(浏览器缺失也是启动事实非 crash)。

    顶层 jars_* 保留 = douyin 段(旧 TS zod 兼容);platforms 为全量。
    """

    jars_total: int = 0
    jars_available: int = 0
    egress_proxy: bool = False
    platforms: dict[str, PlatformHealth] = Field(default_factory=dict)


class ProxyTestRequest(BaseModel):
    """出口代理连通性探针请求(M33 批B):代理 URL 仅过境即测,网关不落盘。"""

    proxy: str = Field(min_length=8, max_length=500)


class ProxyTestResponse(BaseModel):
    ok: bool
    latency_ms: int
    detail: str


def extract_sec_uid(text: str) -> str | None:
    """从任意文本(链接/分享口令/裸 sec_uid)提取抖音 sec_uid。"""
    match = SEC_UID_PATTERN.search(text)
    return match.group(0) if match else None


def create_app(
    signer_settings: SignerSettings | None = None,
    xhs_settings: XhsSettings | None = None,
) -> FastAPI:
    """构建网关应用;runtime 可注入(测试用)。"""
    runtime = GatewayRuntime(signer_settings)
    runtime_holder: dict[str, GatewayRuntime] = {"runtime": runtime}
    xhs_publisher = XhsPublisher(xhs_settings or XhsSettings())

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await runtime.start()
        await xhs_publisher.start()
        try:
            yield
        finally:
            await xhs_publisher.close()
            await runtime.close()

    app = FastAPI(
        title="aitech-hub douyin-gateway",
        description="抖音数据网关:页面 SDK 签名 + Web API 数据端点(内网 only)。",
        lifespan=lifespan,
    )
    app.state.settings = runtime.signer_settings

    # ── 异常 → HTTP 归因(Node 侧按 error 字段分流:502 风控/签名/结构 vs 404 账号)──

    @app.exception_handler(SignRequestError)
    async def _rejected(_: Request, exc: SignRequestError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(SignPageError)
    async def _backend_failure(_: Request, exc: SignPageError) -> JSONResponse:
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    @app.exception_handler(BrowserUnavailableError)
    async def _backend_unavailable(_: Request, exc: BrowserUnavailableError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @app.exception_handler(EgressError)
    async def _egress_unavailable(_: Request, exc: EgressError) -> JSONResponse:
        # 网络层/代理断连(M33 批B):请求未到达对端,基建错误语义 503——
        # Node 侧 GatewayUnavailable 顺延不计失败,jar 冷却态不受影响
        logger.warning("social_egress_error", detail=str(exc)[:200])
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @app.exception_handler(AccountInvalidError)
    async def _account_invalid(_: Request, exc: AccountInvalidError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"error": "AccountInvalidError", "detail": str(exc)})

    @app.exception_handler(DouyinAdapterError)
    async def _adapter_error(_: Request, exc: DouyinAdapterError) -> JSONResponse:
        return JSONResponse(
            status_code=502,
            content={"error": type(exc).__name__, "detail": str(exc)},
        )

    # B 站异常与抖音同构(类名即 error 字段,Node 归因零感知)
    @app.exception_handler(bili_exceptions.AccountInvalidError)
    async def _bili_account_invalid(
        _: Request, exc: bili_exceptions.AccountInvalidError
    ) -> JSONResponse:
        logger.warning(
            "social_bilibili_adapter_error",
            error="AccountInvalidError",
            detail=str(exc)[:200],
        )
        return JSONResponse(status_code=404, content={"error": "AccountInvalidError", "detail": str(exc)})

    @app.exception_handler(bili_exceptions.BilibiliAdapterError)
    async def _bili_adapter_error(
        _: Request, exc: bili_exceptions.BilibiliAdapterError
    ) -> JSONResponse:
        # 观测(2026-10-11 排查缺口):网关侧对适配层错误留痕,不再只有 access log
        logger.warning(
            "social_bilibili_adapter_error",
            error=type(exc).__name__,
            detail=str(exc)[:200],
        )
        return JSONResponse(
            status_code=502,
            content={"error": type(exc).__name__, "detail": str(exc)},
        )

    # ── 签名(与 app.signer.main 独立入口同契约)──

    @app.post("/sign", response_model=SignResponse)
    async def sign(payload: SignRequest) -> SignResponse:
        validate_path(payload.path)
        validate_query(payload.query)
        validate_user_agent(payload.user_agent)
        cookies = parse_cookie_header(payload.cookies)
        normalized = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
        service = runtime.service
        if service is None:
            return JSONResponse(status_code=503, content={"detail": "签名服务未就绪"})
        return await service.sign(
            payload.path, payload.query, payload.user_agent.strip(), normalized
        )

    @app.get("/health", response_model=GatewayHealthResponse)
    async def health() -> GatewayHealthResponse:
        """health 必须永远可答;签名健康叠加 jar 池观测。"""
        stats = runtime.jar_stats()
        service = runtime.service
        if service is None:
            return GatewayHealthResponse(status="starting", **stats)
        return GatewayHealthResponse(**service.health().model_dump(), **stats)

    # ── 小红书自动发布(M49 批X3 POC:选择器译自 xhs-mcp-server,平台改版需迭代)──

    @app.post("/xhs/publish")
    async def xhs_publish(payload: dict) -> dict:
        """发布图文笔记:贴图物料(标题/轻文字/图片容器内绝对路径)→ 创作平台。"""
        title = str(payload.get("title", ""))
        content = str(payload.get("content", ""))
        images = [str(p) for p in payload.get("images", [])]
        pin_id = payload.get("pin_id")
        try:
            result = await xhs_publisher.publish(
                title, content, images, pin_id=str(pin_id) if pin_id else None
            )
            return {"ok": result.ok, "note_url": result.note_url}
        except XhsStateError as exc:
            logger.error("xhs.publish.state_error", error=str(exc))
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            # 全捕获:人话进 detail 供 worker 解析落 lastError,不丢具体原因
            logger.error("xhs.publish.failed", error=str(exc))
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/xhs/state")
    async def xhs_state() -> dict:
        """登录态探针(运维:storage_state 在否 + 创作平台登录判定)。"""
        try:
            return await xhs_publisher.state()
        except Exception as exc:
            # 探针必须可答:登录态缺失/浏览器未启动都以 200 结构化返回
            logger.warning("xhs.state_probe_failed", error=str(exc))
            return {"storage_state_ready": False, "logged_in": None, "error": str(exc)}

    @app.post("/xhs/cookies")
    async def xhs_cookies(payload: dict) -> dict:
        """手动贴 Cookie(抖音同款心智):F12 复制的 cookie 串 → 登录验证 →
        storage_state 落盘(卷持久化,后续发布免登)。"""
        header = str(payload.get("cookie_header", "")).strip()
        if not header:
            raise HTTPException(status_code=400, detail="cookie_header 缺失")
        try:
            return await xhs_publisher.ingest_cookie_header(header)
        except XhsStateError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            # 导航中断等自动化噪声:人话进 detail,前端/worker 可读
            raise HTTPException(status_code=500, detail=f"登录态录入失败: {exc}") from exc

    # ── 数据端点(逐请求注入平台级 jar 池;platform 分发,默认 douyin)──

    @app.post("/posts", response_model=PostsResponse)
    async def posts(payload: PostsRequest) -> PostsResponse:
        if payload.platform == "bilibili":
            return await _posts_bilibili(payload)
        sec_uid = extract_sec_uid(payload.sec_uid) or payload.sec_uid.strip()
        transport = runtime.transport_for(payload.cookies, payload.proxy)
        api = DouyinWebApi(transport)
        videos = []
        has_more = False
        cursor = 0
        for _ in range(payload.max_pages):
            page = await api.get_user_posts(sec_uid, max_cursor=cursor)
            videos.extend(page.videos)
            has_more = page.has_more
            cursor = page.max_cursor
            if not has_more:
                break
        return PostsResponse(
            videos=[VideoOut(**asdict(video)) for video in videos],
            has_more=has_more,
            max_cursor=cursor,
        )

    async def _posts_bilibili(payload: PostsRequest) -> PostsResponse:
        transport = runtime.transport_for_bilibili(payload.cookies, payload.proxy)
        api = BilibiliWebApi(
            transport,
            wbi_cache=runtime.wbi_cache(),
            page_size=runtime.bilibili_settings.posts_page_size,
        )
        videos = []
        has_more = False
        pn = 1
        for _ in range(payload.max_pages):
            page = await api.get_user_posts(payload.sec_uid.strip(), pn=pn)
            videos.extend(page.videos)
            has_more = page.has_more
            pn = page.next_pn
            if not has_more:
                break
        return PostsResponse(
            videos=[VideoOut(**asdict(video)) for video in videos],
            has_more=has_more,
            max_cursor=pn,
        )

    @app.post("/profile", response_model=ProfileResponse)
    async def profile(payload: ProfileRequest) -> ProfileResponse:
        if payload.platform == "bilibili":
            transport = runtime.transport_for_bilibili(payload.cookies, payload.proxy)
            result = await BilibiliWebApi(
                transport, wbi_cache=runtime.wbi_cache()
            ).get_user_profile(payload.sec_uid.strip())
            return ProfileResponse(
                sec_uid=result.mid, nickname=result.nickname, avatar_url=result.avatar_url
            )
        sec_uid = extract_sec_uid(payload.sec_uid) or payload.sec_uid.strip()
        transport = runtime.transport_for(payload.cookies, payload.proxy)
        result = await DouyinWebApi(transport).get_user_profile(sec_uid)
        return ProfileResponse(
            sec_uid=result.sec_uid, nickname=result.nickname, avatar_url=result.avatar_url
        )

    @app.post("/resolve", response_model=ResolveResponse)
    async def resolve(payload: ResolveRequest) -> ResolveResponse:
        if payload.platform == "bilibili":
            mid = extract_mid(payload.url)
            if mid:
                return ResolveResponse(sec_uid=mid)
            transport = runtime.transport_for_bilibili(payload.cookies, payload.proxy)
            expanded = await BilibiliWebApi(
                transport, wbi_cache=runtime.wbi_cache()
            ).expand_short_link(payload.url.strip())
            mid = extract_mid(expanded)
            if not mid:
                await _raise_unprocessable("无法从输入解析 B站 mid,请粘贴 space 主页链接或 mid")
            return ResolveResponse(sec_uid=mid)
        sec_uid = extract_sec_uid(payload.url)
        if sec_uid:
            return ResolveResponse(sec_uid=sec_uid)
        transport = runtime.transport_for(payload.cookies, payload.proxy)
        expanded = await DouyinWebApi(transport).expand_short_link(payload.url.strip())
        sec_uid = extract_sec_uid(expanded)
        if not sec_uid:
            await _raise_unprocessable("无法从输入解析抖音 sec_uid,请粘贴主页链接或 sec_uid")
        return ResolveResponse(sec_uid=sec_uid)

    @app.post("/play-url", response_model=PlayUrlResponse)
    async def play_url(payload: PlayUrlRequest) -> PlayUrlResponse:
        """B 站播放直链现查(模型层限 bilibili;仅解读 job 消费,过境即焚)。"""
        transport = runtime.transport_for_bilibili(payload.cookies, payload.proxy)
        url = await BilibiliWebApi(
            transport, wbi_cache=runtime.wbi_cache()
        ).get_play_url(payload.video_id.strip())
        return PlayUrlResponse(video_id=payload.video_id.strip(), play_url=url)

    @app.post("/subtitle", response_model=SubtitleResponse)
    async def subtitle(payload: SubtitleRequest) -> SubtitleResponse:
        """B 站字幕文本现查(M33 批C 字幕优先:view→cid→player/wbi/v2→字幕
        JSON 下载,择 ai-zh→zh-Hans/zh-CN→首个;无字幕返回 null 调用方落回
        直链+ASR;风险归因矩阵同路)。"""
        transport = runtime.transport_for_bilibili(payload.cookies, payload.proxy)
        text, lang = await BilibiliWebApi(
            transport, wbi_cache=runtime.wbi_cache()
        ).get_subtitle_text(payload.video_id.strip())
        return SubtitleResponse(
            video_id=payload.video_id.strip(), subtitle_text=text, lang=lang
        )

    @app.post("/proxy-test", response_model=ProxyTestResponse)
    async def proxy_test(payload: ProxyTestRequest) -> ProxyTestResponse:
        """出口代理连通性探针(M33 批B):经该代理访问 B 站首页一跳。
        代理 URL 仅过境即测不落盘;4xx 视为通(网络路径已建立,风控墙另计),
        5xx/异常视为不通;探测目标可注入(测试零真网)。"""
        if _probe_runner is not None:
            ok, latency_ms, detail = await _probe_runner(payload.proxy)
            return ProxyTestResponse(ok=ok, latency_ms=latency_ms, detail=detail)
        started = time.monotonic()
        try:
            from curl_cffi.requests import AsyncSession

            async with AsyncSession(impersonate="chrome", proxy=payload.proxy) as session:
                response = await session.get(
                    runtime.bilibili_settings.web_base_url + "/",
                    timeout=10,
                )
            status = getattr(response, "status_code", 0)
            latency_ms = int((time.monotonic() - started) * 1000)
            ok = 0 < status < 500
            return ProxyTestResponse(ok=ok, latency_ms=latency_ms, detail=f"HTTP {status}")
        except Exception as exc:  # noqa: BLE001 - curl_cffi 异常类型随版本漂移
            latency_ms = int((time.monotonic() - started) * 1000)
            return ProxyTestResponse(ok=False, latency_ms=latency_ms, detail=str(exc)[:200])

    return app


async def _raise_unprocessable(detail: str) -> None:
    """resolve 失败统一 422(请求形态问题,非上游故障)。"""
    raise HTTPException(status_code=422, detail=detail)


def _setup_logging() -> None:
    settings = SignerSettings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


_setup_logging()
app = create_app()
