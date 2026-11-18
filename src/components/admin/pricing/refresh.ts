/**
 * 反馈问题三(2026-11-18):牌价管理里滚动到某行改状态,页面跳回顶部——
 * 根因是行内操作后的 `router.refresh()` 会触发本段 loading.tsx 骨架换页,
 * 内容被骨架替换的一瞬文档高度塌缩,浏览器把滚动位钳到顶部。
 *
 * 修法:刷新前记住滚动位置,刷新后的一小段时间内持续归位(覆盖「骨架换出 →
 * 内容换回」整个窗口),骨架消失后滚动停在原行。仅刷新成功路径调用。
 */
export function refreshKeepScroll(router: { refresh: () => void }): void {
  if (typeof window === "undefined") return;
  const y = window.scrollY;
  router.refresh();
  const started = Date.now();
  const restore = (): void => {
    window.scrollTo(0, y);
    if (Date.now() - started < 1200) requestAnimationFrame(restore);
  };
  requestAnimationFrame(restore);
}
