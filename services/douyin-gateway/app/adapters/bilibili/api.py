"""B 站 Web API 封装:投稿列表 / 主页卡片 / 短链展开 / 播放直链,含归一化。

与抖音 api 的差异:listing(arc/search)不带播放直链——直链需 per-video
view→cid→playurl 两次请求,只能解读时现查(get_play_url),listing 阶段
play_url 恒 None;点赞/分享数 vlist 不提供,恒 None。
适配层依赖方向:api → transport/wbi;本模块不依赖服务层。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

from app.adapters.bilibili.exceptions import (
    AccountInvalidError,
    BilibiliAdapterError,
    StructureDriftError,
)
from app.adapters.bilibili.transport import BilibiliTransport
from app.adapters.bilibili.wbi import (
    WbiKeyCache,
    derive_mixin_key,
    sign_wbi_params,
    wbi_key_from_url,
)

# 2026-10 社区实测:投稿列表已迁 wbi 变体(旧 /x/space/arc/search 返回 -412)
_POSTS_PATH = "/x/space/wbi/arc/search"
_PROFILE_PATH = "/x/web-interface/card"
_VIEW_PATH = "/x/web-interface/view"
_PLAY_URL_PATH = "/x/player/wbi/playurl"
_NAV_PATH = "/x/web-interface/nav"

# 未登录上限:360p mp4(fnval=1 mp4 容器;platform=html5 免登录;高画质需大会员)
_PLAY_QN = 32
_PLAY_FNVAL = 1


@dataclass(slots=True)
class BilibiliProfile:
    """UP 主主页归一化结果。"""

    mid: str
    nickname: str
    avatar_url: str | None = None
    signature: str | None = None


@dataclass(slots=True)
class BilibiliVideo:
    """投稿归一化结果(与 telegram 落库字段对应;play_url 恒 None,解读现查)。"""

    video_id: str  # bvid(BV 号)
    caption: str | None
    topic_tags: list[str] = field(default_factory=list)
    cover_url: str | None = None
    play_url: str | None = None
    duration_seconds: int | None = None
    published_at: datetime | None = None
    digg_count: int | None = None
    comment_count: int | None = None
    share_count: int | None = None
    play_count: int | None = None

    @property
    def title(self) -> str | None:
        """标题取 caption 首行(B 站 title 本身即首行)。"""
        if not self.caption:
            return None
        return self.caption.splitlines()[0][:500] or None


@dataclass(slots=True)
class BilibiliPostsPage:
    """投稿列表分页结果(max_cursor 包络语义:p 翻页)。"""

    videos: list[BilibiliVideo]
    has_more: bool
    next_pn: int


def _to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_length(raw: Any) -> int | None:
    """vlist length 形如 "MM:SS" 或 "HH:MM:SS";垃圾值返回 None。"""
    if not isinstance(raw, str) or ":" not in raw:
        return None
    try:
        parts = [int(p) for p in raw.split(":")]
    except ValueError:
        return None
    if any(p < 0 for p in parts) or len(parts) not in (2, 3):
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + part
    return seconds


def normalize_vlist(raw: dict) -> BilibiliVideo | None:
    """把单条 vlist 条目归一化;缺 bvid 的条目丢弃。"""
    bvid = raw.get("bvid")
    if not bvid:
        return None
    title = str(raw.get("title") or "") or None
    description = str(raw.get("description") or "") or None
    caption = "\n".join(part for part in (title, description) if part) or None
    created = _to_int(raw.get("created"))
    return BilibiliVideo(
        video_id=str(bvid),
        caption=caption,
        cover_url=str(raw.get("pic")) if raw.get("pic") else None,
        duration_seconds=_parse_length(raw.get("length")),
        published_at=(
            datetime.fromtimestamp(created, tz=timezone.utc) if created else None
        ),
        # vlist 不含点赞/分享(弹幕数 video_review 不映射),置 None
        digg_count=None,
        comment_count=_to_int(raw.get("comment")),
        share_count=None,
        play_count=_to_int(raw.get("play")),
    )


class BilibiliWebApi:
    """B 站 Web 接口客户端(wbi 签名由本层组装,Cookie/传输由 transport 承担)。"""

    def __init__(
        self,
        transport: BilibiliTransport,
        wbi_cache: WbiKeyCache,
        page_size: int = 30,
    ) -> None:
        self._transport = transport
        self._wbi = wbi_cache
        self._page_size = page_size

    async def _fetch_nav_mixin(self) -> str:
        """nav 匿名拉 wbi 键并派生 mixin_key;失败重试 1 次(缓存层兜陈旧)。"""
        try:
            data = await self._transport.get_json(_NAV_PATH, "", interpret_code=False)
        except BilibiliAdapterError:
            data = await self._transport.get_json(_NAV_PATH, "", interpret_code=False)
        wbi_img = (data.get("data") or {}).get("wbi_img")
        if not isinstance(wbi_img, dict):
            raise StructureDriftError(f"nav 缺少 wbi_img: {str(data)[:160]}")
        img_key = wbi_key_from_url(str(wbi_img.get("img_url") or ""))
        sub_key = wbi_key_from_url(str(wbi_img.get("sub_url") or ""))
        if not img_key or not sub_key:
            raise StructureDriftError(f"nav wbi_img 键缺失: {str(wbi_img)[:160]}")
        return derive_mixin_key(img_key, sub_key)

    async def get_user_posts(self, mid: str, pn: int = 1) -> BilibiliPostsPage:
        """拉取投稿列表一页(wbi 签名)。

        Args:
            mid: UP 主 mid(1-16 位数字)。
            pn: 页码,从 1 起。

        Returns:
            分页归一化结果(无效条目已过滤)。

        Raises:
            StructureDriftError: 缺少 data.list.vlist 结构。
            RiskControlError: -352/-412 风控(含 jar 冷却)。
        """
        mixin = await self._wbi.get(self._fetch_nav_mixin)
        params = {
            "mid": mid,
            "ps": str(self._page_size),
            "pn": str(pn),
            "tid": "0",
            "keyword": "",
            "order": "pubdate",
            "platform": "web",
            "web_location": "1550101",
            "order_avoided": "true",
        }
        data = await self._transport.get_json(_POSTS_PATH, urlencode(sign_wbi_params(params, mixin)))
        payload = data.get("data")
        if not isinstance(payload, dict):
            raise StructureDriftError(f"posts 缺少 data 对象: {str(data)[:200]}")
        vlist = (payload.get("list") or {}).get("vlist")
        if not isinstance(vlist, list):
            raise StructureDriftError(f"posts 缺少 list.vlist: {str(payload)[:200]}")
        page = payload.get("page") or {}
        count = _to_int(page.get("count"))
        page_size = _to_int(page.get("ps")) or self._page_size
        has_more = pn * page_size < count if count is not None else len(vlist) >= page_size
        videos = [
            video
            for video in (normalize_vlist(item) for item in vlist if isinstance(item, dict))
            if video is not None
        ]
        return BilibiliPostsPage(
            videos=videos,
            has_more=has_more,
            next_pn=pn + 1 if has_more else pn,
        )

    async def get_user_profile(self, mid: str) -> BilibiliProfile:
        """拉取 UP 主主页卡片(匿名可访问;-404 归因账号失效)。

        Raises:
            AccountInvalidError: -404/-400 或卡片为空。
            StructureDriftError: 缺少 data.card 结构。
        """
        data = await self._transport.get_json(_PROFILE_PATH, urlencode({"mid": mid, "photo": "true"}))
        card = (data.get("data") or {}).get("card")
        if not isinstance(card, dict):
            raise StructureDriftError(f"profile 缺少 data.card: {str(data)[:200]}")
        if not card.get("mid"):
            raise AccountInvalidError(f"mid={mid} 主页为空")
        return BilibiliProfile(
            mid=str(card.get("mid")),
            nickname=str(card.get("name") or mid),
            avatar_url=str(card.get("face")) if card.get("face") else None,
            signature=str(card.get("sign")) if card.get("sign") else None,
        )

    async def expand_short_link(self, url: str) -> str:
        """展开 b23.tv 分享短链,取跳转目标地址。"""
        return await self._transport.resolve_redirect(url)

    async def get_play_url(self, bvid: str) -> str | None:
        """解读时现查播放直链(view→cid→playurl,未登录 360p mp4)。

        Returns:
            直链(durl 自带 expires,调用方即取即用);空 durl 返回 None。

        Raises:
            AccountInvalidError: 视频 -404(删除/审核中)。
            StructureDriftError: 结构不符。
        """
        view = await self._transport.get_json(_VIEW_PATH, urlencode({"bvid": bvid}))
        view_payload = view.get("data")
        if not isinstance(view_payload, dict):
            raise StructureDriftError(f"view 缺少 data: {str(view)[:160]}")
        cid = _to_int(view_payload.get("cid"))
        if cid is None:
            raise StructureDriftError(f"view 缺少 cid: {str(view_payload)[:160]}")
        mixin = await self._wbi.get(self._fetch_nav_mixin)
        params = {
            "bvid": bvid,
            "cid": str(cid),
            "qn": str(_PLAY_QN),
            "fnval": str(_PLAY_FNVAL),
            "platform": "html5",
            "high_quality": "1",
        }
        data = await self._transport.get_json(
            _PLAY_URL_PATH, urlencode(sign_wbi_params(params, mixin))
        )
        payload = data.get("data")
        if not isinstance(payload, dict):
            raise StructureDriftError(f"playurl 缺少 data: {str(data)[:160]}")
        durl = payload.get("durl")
        if not isinstance(durl, list) or not durl or not isinstance(durl[0], dict):
            return None
        url = durl[0].get("url")
        return str(url) if url else None
