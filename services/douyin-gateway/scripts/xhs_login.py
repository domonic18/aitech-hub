#!/usr/bin/env python3
"""XHS 创作平台登录态生成(有头浏览器,人工登录一次;M49 批X3)。

在本机(Mac)运行:弹出浏览器 → 创作平台登录页 → 手机验证码/扫码人工登录 →
跳转到发布页即登录成功,storage_state(JSON,含 cookie)落盘到指定路径,
挂进 xhs-gateway 容器(/app/xhs-state)即可自动发布。

用法:
  uv run --no-dev python scripts/xhs_login.py ../../workspace/xhs-state/storage_state.json
(需 playwright:基础依赖已含;过期续期重跑同命令覆盖即可)
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

CREATOR_URL = "https://creator.xiaohongshu.com/publish/publish?from=menu"


def main() -> int:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print("用法:python3 xhs_login.py <storage_state 输出路径>")
        return 1
    out_path = Path(sys.argv[1]).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        context = browser.new_context(locale="zh-CN", timezone_id="Asia/Shanghai")
        page = context.new_page()
        page.goto("https://creator.xiaohongshu.com/login")
        print("请在浏览器中完成登录(验证码/扫码)……")
        # 登录完成判定:跳离 /login 即进入创作平台
        page.wait_for_url("**/publish/**", timeout=300_000)
        context.storage_state(path=str(out_path))
        print(f"登录态已保存:{out_path}")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
