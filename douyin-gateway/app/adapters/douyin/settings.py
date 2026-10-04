"""抖音数据面配置:env 驱动的冻结快照(替代上游 app.core.config 的抖音段)。

默认值与上游 config.py 逐项一致(2026-09 实测参数,见上游
docs/arch/08-social-sentiment.md);env 前缀 ``DOUYIN_`` 自成边界。
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class DouyinSettings(BaseSettings):
    """传输层运行参数(全部有安全默认值,容器内零配置可跑)。"""

    model_config = SettingsConfigDict(env_prefix="DOUYIN_", frozen=True)

    base_url: str = "https://www.douyin.com"
    request_timeout: float = 15.0
    bootstrap_timeout: float = 20.0
    # 限速型 403/429 与 200 空 body 的退避序列(env 传 JSON 数组,如 "[1.0,2.0,5.0]")
    rate_limit_retry_delays: tuple[float, ...] = (1.0, 2.0, 5.0)
    jar_cooldown_base_seconds: int = Field(default=300, ge=1)
    jar_cooldown_max_seconds: int = Field(default=7200, ge=1)
