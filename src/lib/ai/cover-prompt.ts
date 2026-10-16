/**
 * 文生图封面 prompt 与常量(M14 批⑥;纯函数无依赖,orchestrator 与单测共用)。
 * 标题为主体、摘要/标签补语义;要求画面融入标题提炼的主题词文字(2026-10-16
 * 验收反馈问题四:封面通常应带主题文字,M14 的全禁字令是弱文字渲染模型时代
 * 的避险,反转为「只允许主题词」),禁水印/logo/人脸特写。
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
    "文字:从文章标题提炼 2~8 字主题词(核心概念/关键词),以简体中文融入画面," +
      "清晰可读、排版美观、与构图协调;",
    "配色干净、主体明确,适合作为资讯卡片与社交分享封面。",
    "禁止:水印、logo、人脸特写;除主题词外,画面不出现其他文字、字母、数字。",
    meta,
  ].join("\n");
}
