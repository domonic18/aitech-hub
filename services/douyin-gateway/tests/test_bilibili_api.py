"""B 站 Web API 测试:vlist 归一化、body code 归因矩阵、wbi 接线(缓存复用)、
jar 轮换、限速重试、playurl 链(view→cid→playurl)。"""

from typing import Any

import pytest

from app.adapters.bilibili.api import (
    BilibiliWebApi,
    normalize_vlist,
)
from app.adapters.bilibili.exceptions import (
    AccountInvalidError,
    NoJarAvailableError,
    RiskControlError,
    StructureDriftError,
)
from app.adapters.common.egress import EgressError
from app.adapters.bilibili.transport import BilibiliTransport

pytestmark = pytest.mark.unit

IMG_KEY = "7cd084941338484aae1ad9425b84077c"
SUB_KEY = "4932caff0ff746eab6f01bf08b70ac45"


class FakeResponse:
    def __init__(
        self,
        status_code: int = 200,
        payload: "dict[str, Any] | str | None" = None,
        headers: "dict[str, str] | None" = None,
    ) -> None:
        self.status_code = status_code
        if isinstance(payload, str):
            self.text = payload
        else:
            import json

            self.text = json.dumps(payload or {})
        self.headers = headers or {}


class FakeSession:
    def __init__(self, responses: "list[FakeResponse]") -> None:
        self._responses = responses
        self.requested_urls: list[str] = []
        self.requested_headers: list[dict[str, str]] = []

    async def get(self, url: str, **kwargs: Any) -> FakeResponse:
        self.requested_urls.append(url)
        self.requested_headers.append(kwargs.get("headers") or {})
        return self._responses.pop(0)

    async def __aenter__(self) -> "FakeSession":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None


def make_transport(
    responses: "list[FakeResponse]",
    *,
    retry_delays: "tuple[float, ...]" = (0.0,),
    **transport_kwargs: Any,
) -> tuple[BilibiliTransport, FakeSession]:
    session = FakeSession(responses)
    transport = BilibiliTransport(
        cookies=["buvid3=abc; b_nut=xyz"],
        session_factory=lambda: session,
        rate_limit_retry_delays=retry_delays,
        **transport_kwargs,
    )
    return transport, session


def make_api(
    responses: "list[FakeResponse]", *, page_size: int = 30
) -> tuple[BilibiliWebApi, FakeSession]:
    from app.adapters.bilibili.wbi import WbiKeyCache

    transport, session = make_transport(responses)
    api = BilibiliWebApi(transport, wbi_cache=WbiKeyCache(43200), page_size=page_size)
    return api, session


def nav_response() -> FakeResponse:
    """匿名 nav:code -101(未登录)但 wbi_img 有效——transport 不归因此码。"""
    return FakeResponse(
        payload={
            "code": -101,
            "message": "账号未登录",
            "data": {
                "wbi_img": {
                    "img_url": f"https://i0.hdslb.com/bfs/wbi/{IMG_KEY}.png",
                    "sub_url": f"https://i0.hdslb.com/bfs/wbi/{SUB_KEY}.png",
                }
            },
        }
    )


MID = "9469941"

VLIST_FULL = {
    "bvid": "BV1xx411c7mD",
    "title": "10分钟看懂大模型",
    "description": "本期聊推理优化",
    "created": 1757879400,
    "pic": "https://i0.hdslb.com/bfs/archive/cover.jpg",
    "length": "10:03",
    "play": 52341,
    "comment": 214,
}


def posts_payload(count: int = 35) -> dict[str, Any]:
    return {
        "code": 0,
        "message": "0",
        "data": {
            "list": {"vlist": [VLIST_FULL, {"title": "无bvid应丢弃"}]},
            "page": {"pn": 1, "ps": 30, "count": count},
        },
    }


class TestNormalizeVlist:
    def test_full_mapping(self) -> None:
        video = normalize_vlist(VLIST_FULL)
        assert video is not None
        assert video.video_id == "BV1xx411c7mD"
        assert video.caption == "10分钟看懂大模型\n本期聊推理优化"
        assert video.title == "10分钟看懂大模型"
        assert video.cover_url == "https://i0.hdslb.com/bfs/archive/cover.jpg"
        assert video.duration_seconds == 603
        assert video.published_at is not None
        assert video.published_at.isoformat().startswith("2025-09-14T19:50")
        assert video.play_count == 52341
        assert video.comment_count == 214
        assert video.digg_count is None  # vlist 无点赞
        assert video.share_count is None
        assert video.play_url is None  # listing 不带直链,解读现查

    def test_hhmmss_length(self) -> None:
        assert normalize_vlist({**VLIST_FULL, "length": "1:02:03"}).duration_seconds == 3723

    def test_sparse_fields_default_null(self) -> None:
        video = normalize_vlist({"bvid": "BV1xx411c7mD"})
        assert video is not None
        assert video.caption is None
        assert video.duration_seconds is None
        assert video.play_count is None

    def test_bad_length_is_none(self) -> None:
        assert normalize_vlist({**VLIST_FULL, "length": "abc"}).duration_seconds is None

    def test_missing_bvid_dropped(self) -> None:
        assert normalize_vlist({"title": "无 bvid"}) is None


class TestPostsEndpoint:
    async def test_posts_page_parsed_with_wbi_params(self) -> None:
        api, session = make_api([nav_response(), FakeResponse(payload=posts_payload())])
        page = await api.get_user_posts(MID, pn=1)
        assert [v.video_id for v in page.videos] == ["BV1xx411c7mD"]
        assert page.has_more is True
        assert page.next_pn == 2
        posts_url = session.requested_urls[1]
        assert "/x/space/wbi/arc/search?" in posts_url
        assert "mid=9469941" in posts_url
        assert "pn=1" in posts_url
        assert "ps=30" in posts_url
        assert "w_rid=" in posts_url and "wts=" in posts_url
        assert session.requested_headers[1]["Cookie"] == "buvid3=abc; b_nut=xyz"
        assert session.requested_headers[1]["Referer"] == "https://www.bilibili.com/"

    async def test_anonymous_nav_minus_101_not_attributed(self) -> None:
        """nav 匿名返回 -101 不得归因 AccountInvalid(wbi_img 仍有效)。"""
        api, _ = make_api([nav_response(), FakeResponse(payload=posts_payload())])
        page = await api.get_user_posts(MID)
        assert page.videos

    async def test_second_call_reuses_wbi_cache(self) -> None:
        api, session = make_api(
            [nav_response(), FakeResponse(payload=posts_payload()), FakeResponse(payload=posts_payload())]
        )
        await api.get_user_posts(MID)
        await api.get_user_posts(MID)
        assert len(session.requested_urls) == 3  # nav + posts + posts,无第二次 nav
        assert "/x/web-interface/nav?" in session.requested_urls[0]

    async def test_missing_vlist_is_structure_drift(self) -> None:
        api, _ = make_api(
            [nav_response(), FakeResponse(payload={"code": 0, "data": {"list": {}}})]
        )
        with pytest.raises(StructureDriftError):
            await api.get_user_posts(MID)

    async def test_empty_page_has_more_false(self) -> None:
        payload = posts_payload(count=30)  # 1*30 < 30 不成立
        api, _ = make_api([nav_response(), FakeResponse(payload=payload)])
        page = await api.get_user_posts(MID)
        assert page.has_more is False
        assert page.next_pn == 1

    async def test_body_code_minus_352_is_risk_control_and_cools_jar(self) -> None:
        api, session = make_api(
            [nav_response(), FakeResponse(payload={"code": -352, "message": "风控校验失败"})]
        )
        transport = api._transport
        assert transport.jars_available == 1
        with pytest.raises(RiskControlError, match="-352"):
            await api.get_user_posts(MID)
        assert transport.jars_available == 0
        assert len(session.requested_urls) == 2  # 冷却即终态,无重试

    async def test_body_code_minus_412_is_risk_control(self) -> None:
        api, _ = make_api(
            [nav_response(), FakeResponse(payload={"code": -412, "message": "请求被拦截"})]
        )
        with pytest.raises(RiskControlError):
            await api.get_user_posts(MID)

    async def test_body_code_minus_404_is_account_invalid(self) -> None:
        api, _ = make_api(
            [nav_response(), FakeResponse(payload={"code": -404, "message": "啥都木有"})]
        )
        with pytest.raises(AccountInvalidError):
            await api.get_user_posts(MID)

    async def test_unknown_body_code_is_structure_drift(self) -> None:
        api, _ = make_api(
            [nav_response(), FakeResponse(payload={"code": -777, "message": "未知"})]
        )
        with pytest.raises(StructureDriftError):
            await api.get_user_posts(MID)


class TestProfileEndpoint:
    async def test_card_parsed(self) -> None:
        payload = {
            "code": 0,
            "data": {
                "card": {
                    "mid": MID,
                    "name": "AI 技术漫谈",
                    "face": "https://i0.hdslb.com/bfs/face/a.jpg",
                    "sign": "硬核科技",
                }
            },
        }
        api, _ = make_api([FakeResponse(payload=payload)])
        profile = await api.get_user_profile(MID)
        assert profile.mid == MID
        assert profile.nickname == "AI 技术漫谈"
        assert profile.avatar_url == "https://i0.hdslb.com/bfs/face/a.jpg"

    async def test_minus_404_is_account_invalid(self) -> None:
        api, _ = make_api([FakeResponse(payload={"code": -404, "message": "用户不存在"})])
        with pytest.raises(AccountInvalidError):
            await api.get_user_profile(MID)

    async def test_empty_card_is_account_invalid(self) -> None:
        api, _ = make_api([FakeResponse(payload={"code": 0, "data": {"card": {}}})])
        with pytest.raises(AccountInvalidError):
            await api.get_user_profile(MID)

    async def test_missing_card_key_is_structure_drift(self) -> None:
        api, _ = make_api([FakeResponse(payload={"code": 0, "data": {}})])
        with pytest.raises(StructureDriftError):
            await api.get_user_profile(MID)


class TestTransportAttribution:
    async def test_http_412_cools_jar_and_raises_without_retry(self) -> None:
        """B 站风控墙是确定性 412:冷却即终态,重试加速拉黑。"""
        transport, session = make_transport([FakeResponse(status_code=412, payload="")])
        assert transport.jars_available == 1
        with pytest.raises(RiskControlError):
            await transport.get_json("/x/web-interface/view", "bvid=BV1xx411c7mD")
        assert transport.jars_available == 0
        assert len(session.requested_urls) == 1

    async def test_rate_limit_429_retries_without_cooldown(self) -> None:
        transport, session = make_transport(
            [
                FakeResponse(status_code=429, payload=""),
                FakeResponse(payload={"code": 0, "data": {}}),
            ],
            retry_delays=(0.0, 0.0, 0.0),
        )
        data = await transport.get_json("/x/web-interface/view", "bvid=BV1xx411c7mD")
        assert data["code"] == 0
        assert len(session.requested_urls) == 2
        assert transport.jars_available == 1

    async def test_5xx_exhaustion_raises_risk_control_without_cooldown(self) -> None:
        transport, session = make_transport(
            [FakeResponse(status_code=502, payload="bad gateway")] * 4,
            retry_delays=(0.0, 0.0, 0.0),
        )
        with pytest.raises(RiskControlError, match="重试耗尽"):
            await transport.get_json("/x/web-interface/view", "bvid=BV1xx411c7mD")
        assert len(session.requested_urls) == 4
        assert transport.jars_available == 1

    async def test_empty_200_body_retries_then_succeeds(self) -> None:
        transport, session = make_transport(
            [
                FakeResponse(payload=""),
                FakeResponse(payload={"code": 0, "data": {}}),
            ],
            retry_delays=(0.0,),
        )
        data = await transport.get_json("/x/web-interface/view", "bvid=BV1xx411c7mD")
        assert data["code"] == 0
        assert len(session.requested_urls) == 2

    async def test_verify_page_html_is_risk_control(self) -> None:
        transport, _ = make_transport(
            [FakeResponse(payload="<html>请完成安全验证</html>")]
        )
        with pytest.raises(RiskControlError):
            await transport.get_json("/x/web-interface/view", "bvid=BV1xx411c7mD")

    async def test_voucher_body_is_risk_control_and_cools_jar(self) -> None:
        """code=0 + v_voucher(无 durl)= B 站软风控挑战:矩阵归一 RiskControl
        并冷却 jar(2026-10-11 playurl 实测形态,非零码通道捕不到)。"""
        transport, _ = make_transport(
            [
                FakeResponse(
                    payload={
                        "code": 0,
                        "message": "OK",
                        "ttl": 1,
                        "data": {"v_voucher": "voucher_x"},
                    }
                )
            ]
        )
        with pytest.raises(RiskControlError, match="v_voucher"):
            await transport.get_json(
                "/x/player/wbi/playurl", "bvid=BV1xx411c7mD&cid=1"
            )
        assert transport.jars_available == 0

    async def test_durl_with_voucher_still_returns_data(self) -> None:
        """v_voucher 与可用 durl 并存时不误伤:成功路径原样放行,不冷却。"""
        transport, _ = make_transport(
            [
                FakeResponse(
                    payload={
                        "code": 0,
                        "data": {
                            "v_voucher": "voucher_x",
                            "durl": [{"url": "https://cdn.example/360p.mp4"}],
                        },
                    }
                )
            ]
        )
        data = await transport.get_json("/x/player/wbi/playurl", "bvid=BV1xx411c7mD")
        assert data["data"]["durl"][0]["url"] == "https://cdn.example/360p.mp4"
        assert transport.jars_available == 1

    async def test_plain_html_is_structure_drift(self) -> None:
        transport, _ = make_transport([FakeResponse(payload="<html>ok</html>")])
        with pytest.raises(StructureDriftError):
            await transport.get_json("/x/web-interface/view", "bvid=BV1xx411c7mD")

    async def test_no_jar_raises_no_jar_available(self) -> None:
        """池耗尽 ≠ 真风控(2026-10-14 拆分):独立异常类,不冷却任何 jar。"""
        session = FakeSession([])
        transport = BilibiliTransport(cookies=[], session_factory=lambda: session)
        with pytest.raises(NoJarAvailableError, match="无可用 Cookie jar"):
            await transport.get_json("/x/web-interface/view", "bvid=BV1xx411c7mD")
        assert not isinstance(NoJarAvailableError("x"), RiskControlError)

    async def test_network_failure_raises_egress_error_without_cooling(self) -> None:
        """网络/代理层故障(M33 批B)→ EgressError(503 基建语义),jar 不冷却。"""
        session = FakeSession([])

        async def _boom(*args: Any, **kwargs: Any) -> FakeResponse:
            raise OSError("Proxy CONNECT aborted")

        session.get = _boom  # type: ignore[method-assign]
        transport = BilibiliTransport(
            cookies=["buvid3=a"], session_factory=lambda: session, rate_limit_retry_delays=()
        )
        with pytest.raises(EgressError, match="出站请求失败"):
            await transport.get_json("/x/web-interface/view", "bvid=BV1xx411c7mD")
        assert transport.jars_available == 1  # 未冷却

    async def test_rotates_to_next_jar_after_risk_control(self) -> None:
        session = FakeSession(
            [
                FakeResponse(status_code=412, payload=""),
                FakeResponse(payload={"code": 0, "data": {}}),
                FakeResponse(payload={"code": 0, "data": {}}),
            ]
        )
        transport = BilibiliTransport(
            cookies=["buvid3=a", "buvid3=b"], session_factory=lambda: session
        )
        with pytest.raises(RiskControlError):
            await transport.get_json("/x/web-interface/view", "bvid=BV1xx411c7mD")
        # 后续请求跳过冷却中的 jar
        await transport.get_json("/x/web-interface/view", "bvid=BV1xx411c7mD")
        await transport.get_json("/x/web-interface/view", "bvid=BV1xx411c7mD")
        assert session.requested_headers[0]["Cookie"] == "buvid3=a"
        assert session.requested_headers[1]["Cookie"] == "buvid3=b"
        assert session.requested_headers[2]["Cookie"] == "buvid3=b"


class TestPlayUrl:
    VIEW_OK = {
        "code": 0,
        "data": {"bvid": "BV1xx411c7mD", "cid": 1234567, "pages": [{"cid": 1234567}]},
    }
    PLAYURL_OK = {
        "code": 0,
        "data": {
            "quality": 32,
            "durl": [{"url": "https://upos-sz-mirror08c.bilivideo.com/360p.mp4?e=xxx"}],
        },
    }

    async def test_chain_view_cid_playurl(self) -> None:
        api, session = make_api(
            [
                FakeResponse(payload=self.VIEW_OK),
                nav_response(),
                FakeResponse(payload=self.PLAYURL_OK),
            ]
        )
        url = await api.get_play_url("BV1xx411c7mD")
        assert url == "https://upos-sz-mirror08c.bilivideo.com/360p.mp4?e=xxx"
        assert "/x/web-interface/view?" in session.requested_urls[0]
        assert "bvid=BV1xx411c7mD" in session.requested_urls[0]
        play_url = session.requested_urls[2]
        assert "/x/player/wbi/playurl?" in play_url
        assert "cid=1234567" in play_url
        assert "fnval=1" in play_url and "qn=32" in play_url
        assert "platform=html5" in play_url
        assert "w_rid=" in play_url

    async def test_view_minus_404_is_account_invalid(self) -> None:
        api, _ = make_api([FakeResponse(payload={"code": -404, "message": "视频不存在"})])
        with pytest.raises(AccountInvalidError):
            await api.get_play_url("BV1xx411c7mD")

    async def test_missing_cid_is_structure_drift(self) -> None:
        api, _ = make_api([FakeResponse(payload={"code": 0, "data": {"bvid": "BV1xx411c7mD"}})])
        with pytest.raises(StructureDriftError):
            await api.get_play_url("BV1xx411c7mD")

    async def test_empty_durl_returns_none(self) -> None:
        api, _ = make_api(
            [
                FakeResponse(payload=self.VIEW_OK),
                nav_response(),
                FakeResponse(payload={"code": 0, "data": {"durl": []}}),
            ]
        )
        assert await api.get_play_url("BV1xx411c7mD") is None

    async def test_voucher_gate_is_risk_control(self) -> None:
        """playurl 链遇 code=0 + v_voucher(无 durl):transport 矩阵归一风控
        (冷却 jar),不再落 None 降级。"""
        api, _ = make_api(
            [
                FakeResponse(payload=self.VIEW_OK),
                nav_response(),
                FakeResponse(
                    payload={
                        "code": 0,
                        "message": "OK",
                        "ttl": 1,
                        "data": {"v_voucher": "voucher_x"},
                    }
                ),
            ]
        )
        with pytest.raises(RiskControlError, match="v_voucher"):
            await api.get_play_url("BV1xx411c7mD")


class TestSubtitle:
    """字幕优先链(M33 批C):view→cid→player/wbi/v2→字幕 JSON 下载。"""

    VIEW_OK = TestPlayUrl.VIEW_OK

    @staticmethod
    def player_v2(subtitles: "list[dict[str, Any]]") -> FakeResponse:
        return FakeResponse(
            payload={"code": 0, "data": {"subtitle": {"subtitles": subtitles}}}
        )

    SUBTITLE_JSON = {
        "body": [
            {"from": 0.0, "to": 2.4, "content": "大家好,今天聊 KV Cache"},
            {"from": 2.4, "to": 5.1, "content": "先从推理瓶颈说起"},
        ]
    }

    async def test_chain_and_language_priority(self) -> None:
        """ai-zh 优先于 zh-CN,协议相对 URL 补 https,行文按序拼接。"""
        api, session = make_api(
            [
                FakeResponse(payload=self.VIEW_OK),
                nav_response(),
                self.player_v2(
                    [
                        {"lan": "zh-CN", "lan_doc": "中文", "subtitle_url": "//aisubtitle.hdslb.com/zh.json"},
                        {"lan": "ai-zh", "lan_doc": "AI字幕", "subtitle_url": "//aisubtitle.hdslb.com/ai.json"},
                    ]
                ),
                FakeResponse(payload=self.SUBTITLE_JSON),
            ]
        )
        text, lang = await api.get_subtitle_text("BV1xx411c7mD")
        assert text == "大家好,今天聊 KV Cache\n先从推理瓶颈说起"
        assert lang == "ai-zh"
        assert "/x/player/wbi/v2?" in session.requested_urls[2]
        assert "cid=1234567" in session.requested_urls[2] and "w_rid=" in session.requested_urls[2]
        assert session.requested_urls[3] == "https://aisubtitle.hdslb.com/ai.json"

    async def test_no_subtitles_returns_none_pair(self) -> None:
        """游客常见:空字幕表 → (None, None),调用方落回直链+ASR。"""
        api, _ = make_api(
            [FakeResponse(payload=self.VIEW_OK), nav_response(), self.player_v2([])]
        )
        assert await api.get_subtitle_text("BV1xx411c7mD") == (None, None)

    async def test_missing_subtitle_url_is_structure_drift(self) -> None:
        api, _ = make_api(
            [
                FakeResponse(payload=self.VIEW_OK),
                nav_response(),
                self.player_v2([{"lan": "ai-zh", "subtitle_url": ""}]),
            ]
        )
        with pytest.raises(StructureDriftError, match="subtitle_url"):
            await api.get_subtitle_text("BV1xx411c7mD")

    async def test_download_failure_is_structure_drift(self) -> None:
        """字幕文件 HTTP 404:结构漂移上抛(不冷却 jar,CDN 拿不到≠账号风控)。"""
        api, _ = make_api(
            [
                FakeResponse(payload=self.VIEW_OK),
                nav_response(),
                self.player_v2([{"lan": "ai-zh", "subtitle_url": "https://aisubtitle.hdslb.com/x.json"}]),
                FakeResponse(status_code=404, payload=""),
            ]
        )
        with pytest.raises(StructureDriftError, match="HTTP 404"):
            await api.get_subtitle_text("BV1xx411c7mD")


class TestShortLink:
    def make_api_no_wbi(
        self, responses: "list[FakeResponse]"
    ) -> tuple[BilibiliWebApi, FakeSession]:
        from app.adapters.bilibili.wbi import WbiKeyCache

        session = FakeSession(responses)
        transport = BilibiliTransport(cookies=[], session_factory=lambda: session)
        return (
            BilibiliWebApi(transport, wbi_cache=WbiKeyCache(43200)),
            session,
        )

    async def test_expand_follows_location(self) -> None:
        api, _ = self.make_api_no_wbi(
            [FakeResponse(headers={"Location": f"https://space.bilibili.com/{MID}"})]
        )
        assert await api.expand_short_link("https://b23.tv/abc/") == (
            f"https://space.bilibili.com/{MID}"
        )

    async def test_missing_location_is_structure_drift(self) -> None:
        api, _ = self.make_api_no_wbi([FakeResponse(headers={})])
        with pytest.raises(StructureDriftError):
            await api.expand_short_link("https://b23.tv/abc/")
