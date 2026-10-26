"""XHS 自动发布运行参数(env 前缀 XHS_;容器内零配置可跑)。

流程节奏参数为模块级纯常量(不入 env):调参=改码发版,防环境漂移。
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class XhsSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="XHS_", frozen=True)

    # 登录态(/xhs/cookies 粘贴录入验证登录后落盘;配置界面为唯一录入入口)
    storage_state_path: str = "/app/xhs-state/storage_state.json"
    # 创作平台 DOM 选择器(设计文档 §6.2:集中定义,平台改版只动这里;
    # 每条均有实弹实证,失效时渠道行 lastError 带步骤名 + 现场快照定位)
    selectors: dict[str, str] = {
        "creator_tab": ".creator-tab",
        "upload_input": ".upload-input",
        # 标题用 placeholder 定位——.d-text 类被 21 个节点(含装饰 span)共用,
        # DOM 序漂移会致 .first 命中 span 被 fill 拒绝(2026-10-26 实测,§6.1 兜底)
        "title_input": 'input[placeholder*="填写标题"]',
        # 正文富文本已由 Quill 换成 TipTap/ProseMirror(2026-10-26 实测:
        # .ql-editor 零命中,页面唯一 contenteditable 即 .tiptap.ProseMirror)
        "content_editor": ".tiptap.ProseMirror",
        # 发布按钮无选择器可用:<xhs-publish-btn> closed shadow root 对查询
        # 全盲,按宿主存在性断言 + 绝对坐标点击(见 PUBLISH_CLICK_*)
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
    # viewport 钉死:发布按钮按绝对坐标点击,几何须确定
    viewport_width: int = 1280
    viewport_height: int = 720
    # 发布动作(上传+表单+提交)整体超时秒
    publish_timeout_seconds: int = 180


# ---- 发布流程节奏参数(纯代码常量,不入 env:调参=改码发版,防环境漂移)----
# 数值均来自 2026-10-26/27 五层实弹排障,标注实测依据;改动前先看现场快照
NAV_TIMEOUT_MS = 60_000 # 发布页/cookie 验证导航超时
STATE_NAV_TIMEOUT_MS = 30_000 # /xhs/state 探针导航超时
LOGIN_SETTLE_MS = 3_000 # 登录重定向为客户端 JS 触发,等落定再判
TAB_RENDER_TIMEOUT_S = 15 # 「上传图文」tab 轮询等待上限(3s 固定等待曾不够)
TAB_POLL_MS = 500 # tab 轮询步进
TAB_SETTLE_MS = 1_000 # tab 点击后窗格切换稳定等待
TAB_CLICK_TIMEOUT_MS = 5_000 # 单个 tab 候选试点超时(逐个试点,总时长受上限制约)
UPLOAD_SETTLE_MS = 8_000 # 图片上传后编辑区就绪等待(多图/大图留余量)
FILL_SETTLE_MS = 1_500 # 标题/正文填写后稳定等待
PUBLISH_CONFIRM_TIMEOUT_S = 40 # 点击发布→成功信号轮询上限
PUBLISH_POLL_MS = 500 # 成功信号轮询步进
PUBLISH_CLICK_X = 700 # 发布钮中心(viewport 1280×720 截图两次实测;勿用宿主
PUBLISH_CLICK_Y = 675 # 相对计算——宿主含整个内容列,曾点到红钮右侧空白)
PUBLISH_BAR_HOST = "xhs-publish-btn" # 发布操作栏 Web Component 宿主(closed
# shadow root 对 DOM 查询全盲,仅可作存在性断言/坐标参照)
DEBUG_KEEP = 5 # 失败现场快照保留份数(超限删最旧)
