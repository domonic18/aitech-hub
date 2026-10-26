/**
 * 条目点击上报(M28 批①,客户端零依赖助手):首页/电报流条目锚点 onClick 调用,
 * navigator.sendBeacon 发出(点击瞬间发出,外链 target=_blank 页面卸载也不丢;
 * sendBeacon 不可用静默放弃——统计失败不影响前台)。
 * 服务端契约位在 clicks.ts(zod enum);本文件禁 import clicks.ts(其顶部
 * prisma 会被 client bundle 拉入),surface/kind 字面量两侧同批维护。
 */
export type ClickSurface = "home" | "telegram";
export type ClickKind = "telegram" | "project" | "post";

export interface TrackEntryInput {
  surface: ClickSurface;
  kind: ClickKind;
  /** 条目键:telegram/post=id 文本,project=slug */
  ref: string;
  /** 条目目标(外链 URL 或站内路径;域名服务端解析) */
  target: string;
}

export function trackEntryClick(input: TrackEntryInput): void {
  try {
    const payload = JSON.stringify({
      surface: input.surface,
      kind: input.kind,
      ref: input.ref.slice(0, 100),
      target: input.target.slice(0, 1000),
    });
    navigator.sendBeacon?.("/api/stats/click/", new Blob([payload], { type: "application/json" }));
  } catch {
    // 统计上报失败不影响前台
  }
}
