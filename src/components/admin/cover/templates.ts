/**
 * 封面工作流共享件(M14 批⑤,原型 admin-cover「一次裁剪·多尺寸导出」):
 * 模板常量 + canvas 绘制。react-easy-crop 的 croppedAreaPixels 坐标相对
 * **旋转后**的图幅,导出侧用同一约定(rotateToCanvas 先展开包围盒再取选区)。
 */

export interface CoverTemplate {
  key: string;
  label: string;
  w: number;
  h: number;
  /** 模板说明行(原型 tpl 卡 .use) */
  use: string;
}

/** 原型 tpl-grid 四模板(og 为封面主图,onSet 落它) */
export const COVER_TEMPLATES: ReadonlyArray<CoverTemplate & { defaultOn?: boolean }> = [
  {
    key: "wechat",
    label: "微信公众号头图",
    w: 900,
    h: 383,
    use: "2.35:1 · 多渠道分发",
    defaultOn: true,
  },
  {
    key: "og",
    label: "站内 / OG 卡片",
    w: 1200,
    h: 630,
    use: "1.91:1 · 社交分享卡 · JSON-LD",
    defaultOn: true,
  },
  {
    key: "csdn",
    label: "CSDN / 通用横图",
    w: 1024,
    h: 576,
    use: "16:9 · 多渠道分发",
    defaultOn: true,
  },
  {
    key: "thumb",
    label: "列表缩略图",
    w: 480,
    h: 270,
    use: "16:9 · 前台卡片 thumb_path",
    defaultOn: true,
  },
];

export const OG_KEY = "og";

/** AI 生图上下文(编辑器表单快照;PostEditor→PostMetaPanel→CoverUploader→CoverDialog 透传) */
export interface CoverGenContext {
  title: string;
  excerpt: string;
  tags: string[];
  /** 正文 markdown(可选,M16 问题2:LLM 生成提示词时取样;不传则按标题/摘要生成) */
  contentMd?: string;
}

export function aspectOf(t: CoverTemplate): number {
  return t.w / t.h;
}

/** canvas 导出质量(canvas 编码器,与 worker sharp 的 MEDIA_LIMITS.webpQuality 相互独立) */
export const CANVAS_WEBP_QUALITY = 0.85;

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas toBlob failed"))),
      "image/webp",
      CANVAS_WEBP_QUALITY,
    );
  });
}

/** 旋转展开到包围盒画布(rotation=0 返回 null 免一次无谓复制);
 * 包围盒与 react-easy-crop 的旋转后坐标约定一致 */
export function rotateToCanvas(bmp: ImageBitmap, rotationDeg: number): HTMLCanvasElement | null {
  if (rotationDeg === 0) return null;
  const rad = (rotationDeg * Math.PI) / 180;
  const w = bmp.width;
  const h = bmp.height;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)));
  canvas.height = Math.round(Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(bmp, -w / 2, -h / 2);
  return canvas;
}

/** 按选区切主图(croppedArea 为旋转后坐标,src 须是 rotateToCanvas 的产物或原图) */
export function cropToCanvas(
  src: HTMLCanvasElement | ImageBitmap,
  area: { x: number; y: number; width: number; height: number },
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(area.width);
  canvas.height = Math.round(area.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(src, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** cover-fit 居中适配:主图等比缩放取中央铺满模板画布 */
export function drawCover(
  src: HTMLCanvasElement | ImageBitmap,
  canvas: HTMLCanvasElement,
  t: CoverTemplate,
): void {
  canvas.width = t.w;
  canvas.height = t.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  const scale = Math.max(t.w / src.width, t.h / src.height);
  const sw = t.w / scale;
  const sh = t.h / scale;
  ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, t.w, t.h);
}
