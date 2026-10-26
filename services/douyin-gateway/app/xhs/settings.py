"""XHS 自动发布运行参数(env 前缀 XHS_;容器内零配置可跑)。"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class XhsSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="XHS_", frozen=True)

    # 登录态(/xhs/cookies 粘贴录入验证登录后落盘;配置界面为唯一录入入口)
    storage_state_path: str = "/app/xhs-state/storage_state.json"
    creator_publish_url: str = (
        "https://creator.xiaohongshu.com/publish/publish?from=menu"
    )
    # 发布页跳登录页判定:URL 含 login 即登录态失效
    login_marker: str = "login"
    headless: bool = True
    # 发布动作(上传+表单+提交)整体超时秒
    publish_timeout_seconds: int = 180
