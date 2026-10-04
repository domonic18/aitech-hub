/**
 * data: URI 图片提取(批C 从 clean-html 平移):49 篇实库存在,base64 解码
 * 落盘策略(2026-09-29 用户确认)。迁移侧把载荷替换为落盘 URL;清洗侧对
 * 未落盘残留剥 src 防巨大字符串入库。
 */

export interface Base64Image {
  mime: string;
  /** 原始 base64 载荷(不含 data: 前缀) */
  base64: string;
  ext: string;
}

const DATA_URI_RE = /data:image\/(png|jpe?g|gif|webp|avif);base64,([A-Za-z0-9+/=]+)/g;

const MIME_EXT: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  webp: "webp",
  avif: "avif",
};

/**
 * 把 data: URI 图片替换为 replacer 返回的 URL(迁移:落盘为新 URL;
 * 运行时 M5:进上传管线)。返回改写后 HTML 与提取到的图片清单。
 */
export function rewriteBase64Images(
  html: string,
  replacer: (img: Base64Image, index: number) => string,
): { html: string; images: Base64Image[] } {
  const images: Base64Image[] = [];
  const out = html.replace(DATA_URI_RE, (_m, mime: string, base64: string) => {
    const img: Base64Image = { mime, base64, ext: MIME_EXT[mime] ?? "png" };
    images.push(img);
    return replacer(img, images.length - 1);
  });
  return { html: out, images };
}
