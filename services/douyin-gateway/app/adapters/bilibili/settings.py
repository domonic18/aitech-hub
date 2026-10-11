"""B 站数据面配置:env 驱动的冻结快照(与 douyin settings 同构)。

env 前缀 ``BILIBILI_`` 自成边界;默认值对齐 B 站 Web 端行为(ps=30 一页,
游客 Cookie 即可拉公开数据,wbi 键约每日轮换 → 12h 缓存半程刷新)。
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class BilibiliSettings(BaseSettings):
    """传输层运行参数(全部有安全默认值,容器内零配置可跑)。"""

    model_config = SettingsConfigDict(env_prefix="BILIBILI_", frozen=True)

    api_base_url: str = "https://api.bilibili.com"
    web_base_url: str = "https://www.bilibili.com"
    request_timeout: float = 15.0
    # 限速型 429/5xx 与 200 空 body 的退避序列(env 传 JSON 数组,如 "[1.0,2.0,5.0]")
    rate_limit_retry_delays: tuple[float, ...] = (1.0, 2.0, 5.0)
    jar_cooldown_base_seconds: int = Field(default=300, ge=1)
    jar_cooldown_max_seconds: int = Field(default=7200, ge=1)
    # wbi 键约每日轮换:缓存半程(12h)刷新,陈旧键有官方宽限期仍可签名
    wbi_cache_ttl_seconds: int = Field(default=43200, ge=60)
    posts_page_size: int = Field(default=30, ge=1, le=50)
