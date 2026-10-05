/**
 * 文生图封面 prompt 与常量(M14 批⑥;纯函数无依赖,orchestrator 与单测共用)。
 * 标题为主体、摘要/标签补语义;显式禁文字/水印/人脸特写(封面卡片画面干净)。
 */

/** 每次生成候选张数(一次请求多张;供应商按张计费,2 张是「多候选选用」与成本的平衡) */
export const COVER_CANDIDATE_COUNT = 2;
/** 生图分辨率(混元原生档 1344×768,横版≈16:9;供应商不支持时在其侧报错透出) */
export const COVER_IMAGE_SIZE = "1344x768";

export function buildCoverPrompt(src: { title: string; excerpt: string; tags: string[] }): string {
  const meta = [
    `文章标题:${src.title.trim() || "(无)"}`,
    `摘要:${src.excerpt.trim() || "(无)"}`,
    src.tags.length > 0 ? `关键词:${src.tags.join("、")}` : null,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
  return [
    "为一篇科技资讯文章生成一张横版封面插图(构图约 16:9)。",
    "画面:现代简洁的科技感插画或概念场景,呼应文章主题;",
    "配色干净、主体明确,适合作为资讯卡片与社交分享封面。",
    "禁止:画面中出现任何文字、字母、数字、水印、logo、人脸特写。",
    meta,
  ].join("\n");
}
