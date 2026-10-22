/**
 * 参照图来源标签(零依赖,客户端组件可安全引入;references.ts 自带 prisma,
 * 不能跨到 client bundle)。来源枚举与解析优先级同 references.ts。
 */
export type ReferenceSource = "sample_image" | "video_cover" | "post_image" | "pin_image";

export const REFERENCE_SOURCE_LABEL: Record<ReferenceSource, string> = {
  sample_image: "样例参照图",
  video_cover: "视频封面",
  post_image: "文章配图",
  pin_image: "本创作贴图",
};
