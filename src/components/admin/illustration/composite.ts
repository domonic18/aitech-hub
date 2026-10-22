/**
 * 配图工坊·显隐组合导出(M40 批 B,纯浏览器侧):底板 + 可见图层按 normalized
 * bbox(0-999,左上原点)定位缩放合成 PNG → 交调用方 POST /api/media 入库。
 * spike 实证图层是 bbox 区域高分重提(纵横比与 bbox 一致),按 bbox 映射即无缝。
 */

export interface CompositeLayer {
  mediaPath: string;
  bbox: [number, number, number, number];
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图层加载失败:${src}`));
    img.src = src;
  });
}

/** 合成底板+图层为 PNG Blob(尺寸取底板原始分辨率,不重采样底板) */
export async function exportCompositeBlob(input: {
  baseSrc: string;
  layers: CompositeLayer[];
}): Promise<Blob> {
  const base = await loadImageEl(input.baseSrc);
  const canvas = document.createElement("canvas");
  canvas.width = base.naturalWidth;
  canvas.height = base.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画布不可用(浏览器不支持 2d context)");
  ctx.drawImage(base, 0, 0);
  for (const layer of input.layers) {
    const img = await loadImageEl(layer.mediaPath);
    const [x1, y1, x2, y2] = layer.bbox;
    ctx.drawImage(
      img,
      (x1 / 1000) * canvas.width,
      (y1 / 1000) * canvas.height,
      ((x2 - x1) / 1000) * canvas.width,
      ((y2 - y1) / 1000) * canvas.height,
    );
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) throw new Error("合成导出失败(toBlob 返回空)");
  return blob;
}
