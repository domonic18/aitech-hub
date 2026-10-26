"""XHS 自动发布运行参数(env 前缀 XHS_;容器内零配置可跑)。"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class XhsSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="XHS_", frozen=True)

    # 登录态(/xhs/cookies 粘贴录入验证登录后落盘;配置界面为唯一录入入口)
    storage_state_path: str = "/app/xhs-state/storage_state.json"
    # 创作平台 DOM 选择器(设计文档 §6.2:集中定义,平台改版只动这里;
    # 译自 xhs-mcp-server v0.2.8 实证,失效时渠道行 lastError 带步骤名定位)
    selectors: dict[str, str] = {
        "creator_tab": ".creator-tab",
        "upload_input": ".upload-input",
        # 标题用 placeholder 定位——.d-text 类被 21 个节点(含装饰 span)共用,
        # DOM 序漂移会致 .first 命中 span 被 fill 拒绝(2026-10-26 实测,§6.1 兜底)
        "title_input": 'input[placeholder*="填写标题"]',
        # 正文富文本已由 Quill 换成 TipTap/ProseMirror(2026-10-26 实测:
        # .ql-editor 零命中,页面唯一 contenteditable 即 .tiptap.ProseMirror)
        "content_editor": ".tiptap.ProseMirror",
        "publish_btn": ".publishBtn",
    }
    # 图文 tab 文本(tab 一律按「可见文本+视口内」定位,禁用序号——平台 DOM
    # 存在视口外的隐藏克隆节点,nth 会点中克隆致「outside of the viewport」
    # 超时,2026-10-26 实测)
    image_tab_text: str = "上传图文"
    creator_publish_url: str = (
        "https://creator.xiaohongshu.com/publish/publish?from=menu"
    )
    # 发布页跳登录页判定:URL 含 login 即登录态失效
    login_marker: str = "login"
    headless: bool = True
    # 发布动作(上传+表单+提交)整体超时秒
    publish_timeout_seconds: int = 180
