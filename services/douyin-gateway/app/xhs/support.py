"""XHS 发布流程支撑(M49 批X3' 可维护性收口):

- XhsStateError / XhsPublishResult / XhsStepError:错误与结果类型
- save_failure_artifacts:失败现场快照(截图 + DOM + URL)
- settle_video:视频在 context 关闭后写完——失败搬现场目录,成功即删
适配平台改版的唯一依据是现场快照,禁止盲猜选择器(2026-10-26/27 五层
排障教训)。
"""
from __future__ import annotations

import os
import shutil
import time
from dataclasses import dataclass
from typing import Any

from app.log import get_logger

logger = get_logger(__name__)

# 错误分类(日志与后续重试策略按类区分;人话在 raise 处给出)
KIND_BROWSER = "browser"
KIND_LOGIN = "login"
KIND_SELECTOR = "selector"
KIND_UPLOAD = "upload"
KIND_FILL = "fill"
KIND_CLICK = "click"
KIND_SUCCESS_SIGNAL = "success_signal"
KIND_UNKNOWN = "unknown"


class XhsStateError(RuntimeError):
    """登录态缺失/失效(人话直出给渠道行 lastError;gateway 映射 400)。"""


@dataclass
class XhsPublishResult:
    ok: bool
    note_url: str | None = None


class XhsStepError(RuntimeError):
    """单步失败(步骤名 + 分类 + 现场目录;str() 即人话,直出 lastError)。"""

    def __init__(
        self, step: str, kind: str, msg: str, artifact_dir: str | None = None
    ) -> None:
        self.step = step
        self.kind = kind
        self.msg = msg
        self.artifact_dir: str | None = None
        super().__init__(self._render())
        if artifact_dir:
            self.attach_artifact(artifact_dir)

    def attach_artifact(self, artifact_dir: str | None) -> None:
        """补挂现场目录(快照由 _run_step 统一拍摄)并重渲染 message。"""
        if artifact_dir is None or self.artifact_dir is not None:
            return
        self.artifact_dir = artifact_dir
        RuntimeError.__init__(self, self._render())

    def _render(self) -> str:
        text = f"小红书发布失败[{self.step}]: {self.msg}"
        if self.artifact_dir:
            text += f"(现场已存 {self.artifact_dir})"
        return text


async def save_failure_artifacts(
    page: Any, step: str, debug_root: str, keep: int
) -> str | None:
    """落现场快照:page.png + page.html + url.txt,滚动保留最近 keep 份。

    任何异常都自吞(返回 None)——快照是尽力而为,不得遮蔽原始错误。
    """
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dir_path = os.path.join(debug_root, f"{stamp}_{step.replace(' ', '_')}")
    try:
        os.makedirs(dir_path, exist_ok=True)
        await page.screenshot(path=os.path.join(dir_path, "page.png"))
        with open(os.path.join(dir_path, "page.html"), "w", encoding="utf-8") as f:
            f.write(await page.content())
        with open(os.path.join(dir_path, "url.txt"), "w", encoding="utf-8") as f:
            f.write(page.url)
        entries = sorted(
            e
            for e in os.listdir(debug_root)
            if os.path.isdir(os.path.join(debug_root, e))
        )
        for old in entries[:-keep]:
            shutil.rmtree(os.path.join(debug_root, old), ignore_errors=True)
        logger.warning("xhs.artifact_saved", dir=dir_path, step=step)
        return dir_path
    except Exception as exc:
        logger.warning("xhs.artifact_save_failed", step=step, error=str(exc))
        return None


async def settle_video(video: Any, artifact_dir: str | None) -> None:
    """视频在 context 关闭后才写完:失败搬进现场目录,成功即删。"""
    if video is None:
        return
    try:
        src = await video.path()
        logger.info("xhs.video_path", src=src, exists=os.path.exists(src) if src else False)
        if not src or not os.path.exists(src):
            return
        if artifact_dir:
            os.makedirs(artifact_dir, exist_ok=True)
            shutil.move(src, os.path.join(artifact_dir, "flow.webm"))
        else:
            os.remove(src)
    except Exception as exc:
        logger.warning("xhs.video_settle_failed", error=str(exc))
